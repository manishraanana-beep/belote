import http from "node:http";
import { WebSocketServer } from "ws";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  newGame,
  act,
  view,
  botAction,
  nextDeal,
  expireCounter,
  DEFAULT_RULES,
} from "./engine.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = () => randomBytes(24).toString("base64url");
const clean = (v, max = 40) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
function check(ok, message) {
  if (!ok) throw Error(message);
}
function rules(input = {}) {
  const r = { ...DEFAULT_RULES };
  for (const k of [
    "target",
    "turnSeconds",
    "reconnectSeconds",
    "counterWindowSeconds",
    "capotValue",
  ]) {
    if (input[k] !== undefined) {
      check(Number.isInteger(input[k]), "Paramètre numérique invalide");
      r[k] = input[k];
    }
  }
  check(
    r.target >= 100 &&
      r.target <= 10000 &&
      r.turnSeconds >= 5 &&
      r.turnSeconds <= 120 &&
      r.reconnectSeconds >= 10 &&
      r.reconnectSeconds <= 600 &&
      r.counterWindowSeconds >= 2 &&
      r.counterWindowSeconds <= 30 &&
      r.capotValue >= 160 &&
      r.capotValue <= 500,
    "Règles hors limites",
  );
  for (const k of ["flyingCounter", "beloteRetained", "beloteCountsContract"])
    if (input[k] !== undefined) {
      check(typeof input[k] === "boolean", "Règle invalide");
      r[k] = input[k];
    }
  for (const [k, options] of [
    ["scoring", ["added", "contract"]],
    ["allPass", ["redeal", "rotate"]],
  ])
    if (input[k] !== undefined) {
      check(options.includes(input[k]), "Variante inconnue");
      r[k] = input[k];
    }
  return r;
}
const hashPassword = (password, salt) =>
  scryptSync(password, salt, 32).toString("hex");
export function createApp({
  dataDir = process.env.BELOTE_DATA_DIR || path.join(root, ".data"),
  tickMs = 250,
  botDelay = 800,
  adminKey = process.env.BELOTE_ADMIN_KEY,
} = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "state.json");
  let db = {
    players: {},
    tables: {},
    reports: [],
    settings: { maintenance: false },
  };
  if (existsSync(file)) db = JSON.parse(readFileSync(file, "utf8"));
  let closing = false;
  const connections = new Map(),
    rate = new Map();
  function persist() {
    writeFileSync(file + ".tmp", JSON.stringify(db), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  }
  function table(name, owner, vip = false, r = {}) {
    const t = {
      id: id(),
      name,
      owner,
      vip,
      rules: rules(r),
      seats: [null, null, null, null],
      pending: [],
      chat: [],
      game: null,
      invite: vip ? id() : null,
      password: null,
      revision: 0,
      deadline: null,
      botAt: 0,
      created: Date.now(),
    };
    db.tables[t.id] = t;
    return t;
  }
  if (!Object.values(db.tables).some((t) => !t.vip))
    table("Le Salon • Contrée", null);
  // No live connection survives a server restart. Reservations restart with the configured grace.
  for (const t of Object.values(db.tables))
    for (const s of t.seats) if (s && !s.bot) s.disconnectedAt = Date.now();
  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  function publicTable(t) {
    return {
      id: t.id,
      name: t.name,
      vip: t.vip,
      available: t.seats.filter((s) => !s).length,
      status:
        t.game && !["finished"].includes(t.game.phase)
          ? "Partie en cours"
          : "En attente",
      rules: t.rules,
    };
  }
  function publicSeat(s) {
    return s
      ? {
          id: s.id,
          name: s.name,
          avatar: s.avatar,
          bot: !!s.bot,
          connected: s.bot || connections.has(s.id),
          disconnectedAt: s.disconnectedAt ?? null,
        }
      : null;
  }
  function snapshot(t, pid) {
    const seat = t.seats.findIndex((s) => s?.id === pid);
    return {
      ...publicTable(t),
      owner: t.owner,
      gameId: t.gameId,
      seats: t.seats.map(publicSeat),
      revision: t.revision,
      deadline: t.deadline,
      chat: t.chat,
      pending:
        pid === t.owner
          ? t.pending.map((p) => ({ id: p, name: db.players[p]?.name }))
          : [],
      invite: pid === t.owner ? t.invite : undefined,
      game: t.game ? view(t.game, seat >= 0 ? seat : null) : null,
    };
  }
  function playerView(p) {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      stats: p.stats,
      history: p.history,
      banned: !!p.banned,
    };
  }
  function broadcast() {
    if (closing) return;
    persist();
    for (const [pid, set] of connections) {
      const p = db.players[pid];
      const t = db.tables[p.tableId];
      for (const ws of set)
        send(ws, {
          type: "state",
          player: playerView(p),
          tables: Object.values(db.tables)
            .filter((t) => !t.vip)
            .map(publicTable),
          table: t ? snapshot(t, pid) : null,
          requests: Object.values(db.tables)
            .filter((t) => t.pending.includes(pid))
            .map((t) => ({ id: t.id, name: t.name })),
          maintenance: db.settings.maintenance,
        });
    }
  }
  function schedule(t) {
    t.deadline =
      t.game && ["bidding", "playing"].includes(t.game.phase)
        ? Date.now() + t.rules.turnSeconds * 1000
        : null;
    t.botAt = Date.now() + botDelay;
  }
  function update(t) {
    t.revision++;
    schedule(t);
  }
  function finishStats(t) {
    if (t.game.phase !== "finished" || t.recorded === t.gameId) return;
    t.recorded = t.gameId;
    for (let seat = 0; seat < 4; seat++) {
      const s = t.seats[seat],
        p = s && !s.bot ? db.players[s.id] : null;
      if (p) {
        const won = t.game.scores[seat % 2] > t.game.scores[1 - (seat % 2)];
        p.stats.games++;
        if (won) p.stats.wins++;
        p.history.unshift({
          table: t.name,
          date: Date.now(),
          scores: t.game.scores,
          won,
        });
        p.history = p.history.slice(0, 30);
      }
    }
  }
  function start(t) {
    check(t.seats.every(Boolean), "Il faut quatre joueurs");
    t.game = newGame(t.rules);
    t.gameId = id();
    update(t);
  }
  function leave(p) {
    const t = db.tables[p.tableId];
    if (!t) {
      p.tableId = null;
      return;
    }
    check(
      !t.game || t.game.phase === "finished",
      "La place reste réservée pendant la partie. Vous pouvez fermer la page et revenir.",
    );
    t.seats = t.seats.map((s) => (s?.id === p.id ? null : s));
    if (t.owner === p.id)
      t.owner = t.seats.find((s) => s && !s.bot)?.id ?? null;
    p.tableId = null;
    update(t);
  }
  function validateInvite(target, d) {
    check(target, "Table introuvable");
    if (target.vip) {
      check(
        typeof d.invite === "string" && d.invite === target.invite,
        "Invitation invalide",
      );
      if (target.password)
        check(
          typeof d.password === "string" &&
            d.password.length <= 128 &&
            timingSafeEqual(
              Buffer.from(
                hashPassword(d.password, target.password.salt),
                "hex",
              ),
              Buffer.from(target.password.hash, "hex"),
            ),
          "Mot de passe incorrect",
        );
    }
  }
  function consume(pid) {
    const now = Date.now();
    let r = rate.get(pid);
    if (!r || now - r.at > 1000) {
      r = { at: now, n: 0 };
      rate.set(pid, r);
    }
    check(++r.n <= 25, "Trop de requêtes");
  }
  function command(pid, msg) {
    const p = db.players[pid];
    check(!p.banned, "Profil suspendu");
    check(
      msg &&
        typeof msg === "object" &&
        typeof msg.id === "string" &&
        msg.id.length <= 100,
      "Identifiant de commande requis",
    );
    if (p.seen.includes(msg.id)) return { duplicate: true };
    consume(pid);
    const d = msg.data ?? {},
      t = db.tables[p.tableId];
    let changed;
    switch (msg.type) {
      case "profile":
        p.name = clean(d.name, 24) || p.name;
        p.avatar = ["♠", "♥", "♦", "♣", "👑", "🌟"].includes(d.avatar)
          ? d.avatar
          : p.avatar;
        if (t) {
          const s = t.seats.find((s) => s?.id === pid);
          if (s) {
            s.name = p.name;
            s.avatar = p.avatar;
          }
        }
        break;
      case "create":
        rules(d.rules);
        if (d.password)
          check(
            typeof d.password === "string" && d.password.length <= 128,
            "Mot de passe invalide",
          );
        check(!db.settings.maintenance, "Création temporairement fermée");
        if (p.tableId) leave(p);
        check(
          Object.values(db.tables).filter((t) => t.owner === pid).length < 5,
          "Maximum cinq tables",
        );
        changed = table(clean(d.name) || "Table privée", pid, !!d.vip, d.rules);
        changed.seats[0] = { id: pid, name: p.name, avatar: p.avatar };
        p.tableId = changed.id;
        if (d.password) {
          check(
            typeof d.password === "string" && d.password.length <= 128,
            "Mot de passe invalide",
          );
          const salt = id();
          changed.password = { salt, hash: hashPassword(d.password, salt) };
        }
        break;
      case "inspectInvite": {
        const target = db.tables[d.tableId];
        validateInvite(target, d);
        return { invitation: publicTable(target) };
      }
      case "join": {
        check(!db.settings.maintenance, "Entrées temporairement fermées");
        const target = db.tables[d.tableId];
        check(target, "Table introuvable");
        check(
          !target.game || target.game.phase === "finished",
          "Partie déjà commencée",
        );
        check(!p.tableId, "Quittez votre table actuelle");
        check(
          target.seats.some((s) => !s),
          "Table complète",
        );
        if (target.vip) {
          validateInvite(target, d);
          if (!target.pending.includes(pid)) target.pending.push(pid);
        } else {
          const seat = target.seats.indexOf(null);
          target.seats[seat] = { id: pid, name: p.name, avatar: p.avatar };
          p.tableId = target.id;
          if (!target.owner) target.owner = pid;
        }
        changed = target;
        break;
      }
      case "admit":
      case "reject":
        check(t && t.owner === pid, "Créateur uniquement");
        check(!t.game || t.game.phase === "finished", "Partie commencée");
        check(t.pending.includes(d.playerId), "Demande introuvable");
        if (msg.type === "admit") {
          const guest = db.players[d.playerId];
          check(guest && !guest.tableId, "Joueur indisponible");
          const seat = Number.isInteger(d.seat)
            ? d.seat
            : t.seats.indexOf(null);
          check(seat >= 0 && seat < 4 && !t.seats[seat], "Place indisponible");
          t.seats[seat] = {
            id: guest.id,
            name: guest.name,
            avatar: guest.avatar,
          };
          guest.tableId = t.id;
        }
        t.pending = t.pending.filter((v) => v !== d.playerId);
        changed = t;
        break;
      case "move":
        check(t && t.owner === pid, "Créateur uniquement");
        check(
          !t.game || t.game.phase === "finished",
          "Places figées après lancement",
        );
        check(
          [d.from, d.to].every((v) => Number.isInteger(v) && v >= 0 && v < 4),
          "Place invalide",
        );
        [t.seats[d.from], t.seats[d.to]] = [t.seats[d.to], t.seats[d.from]];
        changed = t;
        break;
      case "seat":
        check(
          t && (!t.game || t.game.phase === "finished"),
          "Places figées après lancement",
        );
        {
          const from = t.seats.findIndex((s) => s?.id === pid);
          check(
            from >= 0 &&
              Number.isInteger(d.seat) &&
              d.seat >= 0 &&
              d.seat < 4 &&
              !t.seats[d.seat],
            "Place indisponible",
          );
          t.seats[d.seat] = t.seats[from];
          t.seats[from] = null;
          changed = t;
        }
        break;
      case "kick":
      case "bot":
      case "rules":
      case "start":
      case "rematch":
        check(t && t.owner === pid, "Créateur uniquement");
        check(
          !t.game || t.game.phase === "finished",
          "Options figées pendant une partie",
        );
        if (msg.type === "rules") t.rules = rules(d.rules);
        if (msg.type === "bot") {
          check(
            Number.isInteger(d.seat) &&
              d.seat >= 0 &&
              d.seat < 4 &&
              !t.seats[d.seat],
            "Place indisponible",
          );
          t.seats[d.seat] = {
            id: "bot-" + id(),
            name: ["Émile", "Camille", "Lucie", "Marcel"][d.seat],
            avatar: "♣",
            bot: true,
          };
        }
        if (msg.type === "kick") {
          check(
            Number.isInteger(d.seat) &&
              d.seat >= 0 &&
              d.seat < 4 &&
              t.seats[d.seat]?.id !== pid,
            "Place invalide",
          );
          const guest = t.seats[d.seat];
          if (guest && !guest.bot) db.players[guest.id].tableId = null;
          t.seats[d.seat] = null;
        }
        if (["start", "rematch"].includes(msg.type)) start(t);
        changed = t;
        break;
      case "practice":
        check(!db.settings.maintenance, "Création temporairement fermée");
        rules(d.rules);
        if (p.tableId) leave(p);
        changed = table("Entraînement", pid, true, d.rules);
        changed.seats[0] = { id: pid, name: p.name, avatar: p.avatar };
        for (let i = 1; i < 4; i++)
          changed.seats[i] = {
            id: "bot-" + id(),
            name: ["", "Camille", "Lucie", "Marcel"][i],
            avatar: "♣",
            bot: true,
          };
        p.tableId = changed.id;
        start(changed);
        break;
      case "leave":
        leave(p);
        break;
      case "action":
        check(t?.game, "Partie introuvable");
        check(d.version === t.game.version, "Action périmée : état actualisé");
        {
          const seat = t.seats.findIndex((s) => s?.id === pid);
          check(seat >= 0, "Joueur non assis");
          act(t.game, seat, d.action);
          finishStats(t);
          changed = t;
        }
        break;
      case "next":
        check(t?.game, "Partie introuvable");
        nextDeal(t.game);
        changed = t;
        break;
      case "chat":
        check(t, "Rejoignez une table");
        {
          const text = clean(d.text, 280);
          check(text, "Message vide");
          t.chat.push({ id: id(), name: p.name, text, at: Date.now() });
          t.chat = t.chat.slice(-60);
        }
        break;
      case "report":
        check(clean(d.reason, 500), "Motif requis");
        check(
          db.reports.filter((r) => r.by === pid && Date.now() - r.at < 3600000)
            .length < 10,
          "Trop de signalements",
        );
        db.reports.push({
          id: id(),
          by: pid,
          table: t?.id,
          reason: clean(d.reason, 500),
          at: Date.now(),
          resolved: false,
        });
        break;
      default:
        throw Error("Commande inconnue");
    }
    if (changed) update(changed);
    p.seen.push(msg.id);
    p.seen = p.seen.slice(-200);
    broadcast();
    return { ok: true };
  }
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
  };
  function getPlayer(req) {
    const token = /\bbelote_session=([A-Za-z0-9_-]+)/.exec(
      req.headers.cookie ?? "",
    )?.[1];
    return Object.values(db.players).find((p) => p.token === token);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true }));
    }
    if (url.pathname === "/api/session" && req.method === "POST") {
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      ) {
        res.writeHead(403);
        return res.end();
      }
      let p = getPlayer(req);
      if (p?.banned) {
        res.writeHead(403);
        return res.end("Profil suspendu");
      }
      if (!p) {
        p = {
          id: id(),
          token: id(),
          name: "Joueur " + randomBytes(2).toString("hex"),
          avatar: "♠",
          stats: { games: 0, wins: 0 },
          history: [],
          tableId: null,
          seen: [],
        };
        db.players[p.id] = p;
        persist();
      }
      res.setHeader(
        "Set-Cookie",
        `belote_session=${p.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${req.socket.encrypted || process.env.BELOTE_SECURE_COOKIE === "true" ? "; Secure" : ""}`,
      );
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      return res.end(JSON.stringify(playerView(p)));
    }
    if (url.pathname === "/api/admin") {
      const supplied = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (
        !adminKey ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(adminKey) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(adminKey))
      ) {
        res.writeHead(403);
        return res.end("Administration non autorisée");
      }
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) {
            res.writeHead(413);
            return res.end();
          }
        }
        try {
          const d = JSON.parse(body);
          if (d.type === "resolve") {
            const r = db.reports.find((r) => r.id === d.id);
            check(r, "Signalement introuvable");
            r.resolved = true;
          } else if (d.type === "maintenance") {
            check(typeof d.enabled === "boolean", "Valeur invalide");
            db.settings.maintenance = d.enabled;
          } else if (d.type === "suspend") {
            const p = db.players[d.id];
            check(p, "Joueur introuvable");
            check(typeof d.enabled === "boolean", "Valeur invalide");
            p.banned = d.enabled;
            if (p.banned)
              for (const ws of connections.get(p.id) ?? [])
                ws.close(1008, "Profil suspendu");
          } else if (d.type === "deleteTable") {
            const t = db.tables[d.id];
            check(t, "Table introuvable");
            check(
              !t.game || t.game.phase === "finished",
              "Impossible de supprimer une partie en cours",
            );
            for (const s of t.seats)
              if (s && !s.bot) db.players[s.id].tableId = null;
            delete db.tables[t.id];
            if (!Object.values(db.tables).some((t) => !t.vip))
              table("Le Salon • Contrée", null);
          } else throw Error("Commande inconnue");
          broadcast();
        } catch (e) {
          res.writeHead(400);
          return res.end(e.message);
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      return res.end(
        JSON.stringify({
          players: Object.values(db.players).map(playerView),
          tables: Object.values(db.tables).map(publicTable),
          reports: db.reports,
          settings: db.settings,
        }),
      );
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const allowed = [
      "index.html",
      "app.js",
      "cards.js",
      "style.css",
      "cards-LICENSE.txt",
    ];
    const cardFile = /^cards\/(?:[789]|10|[JQKA])[SHCD]\.svg$/.test(rel);
    if (!allowed.includes(rel) && !cardFile) {
      res.writeHead(404);
      return res.end("Introuvable");
    }
    res.setHeader("Content-Type", mime[path.extname(rel)]);
    if (cardFile) res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(readFileSync(path.join(root, "public", rel)));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on("upgrade", (req, socket, head) => {
    const p = getPlayer(req),
      origin = req.headers.origin;
    if (
      req.url !== "/ws" ||
      !p ||
      p.banned ||
      (origin &&
        origin !== `http://${req.headers.host}` &&
        origin !== `https://${req.headers.host}`)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, p));
  });
  wss.on("connection", (ws, p) => {
    let set = connections.get(p.id);
    if (!set) {
      set = new Set();
      connections.set(p.id, set);
    }
    set.add(ws);
    const t = db.tables[p.tableId];
    const seat = t?.seats.find((s) => s?.id === p.id);
    if (seat) delete seat.disconnectedAt;
    broadcast();
    ws.alive = true;
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
        const result = command(p.id, msg);
        send(ws, { type: "ack", id: msg.id, ...result });
      } catch (e) {
        send(ws, { type: "error", id: msg?.id, message: e.message });
        broadcast();
      }
    });
    ws.on("close", () => {
      set.delete(ws);
      if (!set.size) {
        connections.delete(p.id);
        const t = db.tables[p.tableId],
          s = t?.seats.find((s) => s?.id === p.id);
        if (s) s.disconnectedAt = Date.now();
        broadcast();
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 15000);
  heartbeat.unref();
  const timer = setInterval(() => {
    let dirty = false;
    const now = Date.now();
    for (const t of Object.values(db.tables)) {
      if (!t.game) {
        for (let i = 0; i < 4; i++) {
          const s = t.seats[i];
          if (
            s &&
            !s.bot &&
            s.disconnectedAt &&
            now - s.disconnectedAt > t.rules.reconnectSeconds * 1000
          ) {
            t.seats[i] = null;
            db.players[s.id].tableId = null;
            if (t.owner === s.id)
              t.owner = t.seats.find((s) => s && !s.bot)?.id ?? null;
            t.revision++;
            dirty = true;
          }
        }
        continue;
      }
      const g = t.game;
      if (expireCounter(g, now)) {
        update(t);
        dirty = true;
      }
      if (["bidding", "playing"].includes(g.phase)) {
        const s = t.seats[g.turn];
        const absent =
          s &&
          !s.bot &&
          !connections.has(s.id) &&
          s.disconnectedAt &&
          now - s.disconnectedAt >= t.rules.reconnectSeconds * 1000;
        if (
          ((s?.bot || absent) && now >= t.botAt) ||
          (t.deadline && now >= t.deadline)
        ) {
          const a =
            s?.bot || absent
              ? botAction(view(g, g.turn))
              : g.phase === "bidding"
                ? { type: "pass" }
                : { type: "play", card: view(g, g.turn).legal[0] };
          try {
            act(g, g.turn, a);
            finishStats(t);
            update(t);
            dirty = true;
          } catch (e) {
            console.error("Automatisme impossible:", e.message);
          }
        }
      }
    }
    if (dirty) broadcast();
  }, tickMs);
  timer.unref();
  persist();
  return {
    server,
    db,
    close: () =>
      new Promise((resolve) => {
        closing = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        persist();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(resolve));
      }),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, "0.0.0.0", () =>
    console.log(`Belote prête, port ${port}`),
  );
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () => app.close().then(() => process.exit(0)));
}
