import test from "node:test";
import { newGame } from "../src/engine.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server.js";
import { strongestCard } from "../src/engine.js";
import { view } from "../src/engine.js";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "belote-test-"));
  // Les tests utilisent aussi une table permanente gratuite (absente en production).
  const app = createApp({ dataDir: dir, tickMs: 10, botDelay: 1, matchWaitMs: 0, ...opts, env: { ...process.env, BELOTE_LOBBY_STAKES: "0,200,500,1000", ...(opts.env ?? {}) } });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const clients = [];
  async function client(cookie) {
    if (!cookie) {
      const r = await fetch(base + "/api/session", { method: "POST" });
      cookie = r.headers.get("set-cookie").split(";")[0];
    }
    const c = { cookie, state: null, queue: [], next: 0 };
    c.ws = new WebSocket(base.replace("http", "ws") + "/ws", {
      headers: { Cookie: cookie, Origin: base },
    });
    c.ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "state") c.state = m;
      else c.queue.push(m);
    });
    c.wait = async (predicate) => {
      for (let i = 0; i < 500; i++) {
        if (predicate(c)) return;
        await delay(5);
      }
      throw Error("Attente expirée");
    };
    await c.wait((c) => c.state);
    c.send = (type, data = {}, id = randomUUID()) => {
      c.ws.send(JSON.stringify({ id, type, data }));
      return id;
    };
    c.command = async (type, data = {}, expected = "ack") => {
      const id = c.send(type, data);
      await c.wait((c) => c.queue.some((m) => m.id === id));
      const m = c.queue.find((m) => m.id === id);
      assert.equal(m.type, expected, m.message);
      return m;
    };
    clients.push(c);
    return c;
  }
  return {
    app,
    base,
    client,
    dir,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("quatre connexions : mains privées, arbitrage simultané, doublons, surcontre et reconnexion", async () => {
  const f = await fixture();
  try {
    const players = await Promise.all(
      Array.from({ length: 4 }, () => f.client()),
    );
    const t = players[0].state.tables[0];
    for (const p of players) await p.command("join", { tableId: t.id });
    // Table publique permanente : départ automatique dès le quatrième joueur assis.
    await players[0].wait((c) => c.state.table?.game);
    await players[3].wait((c) => c.state.table?.game);
    const all = players.flatMap((p) => p.state.table.game.hand);
    assert.equal(new Set(all).size, 32);
    for (const p of players) {
      assert.equal(p.state.table.game.hand.length, 8);
      assert.equal("hands" in p.state.table.game, false);
      assert.equal(
        p.state.table.seats.some((s) => "hand" in s),
        false,
      );
    }
    let v = players[0].state.table.game.version;
    await players[0].command("action", {
      version: v,
      action: { type: "bid", amount: 80, suit: "S" },
    });
    await players[3].wait((c) => c.state.table.game.contract?.amount === 80);
    v = players[0].state.table.game.version;
    const id1 = players[1].send(
      "action",
      { version: v, action: { type: "counter" } },
      "race-counter-a",
    );
    const id2 = players[3].send(
      "action",
      { version: v, action: { type: "counter" } },
      "race-counter-b",
    );
    await players[1].wait((c) => c.queue.some((m) => m.id === id1));
    await players[3].wait((c) => c.queue.some((m) => m.id === id2));
    const outcomes = [
      players[1].queue.find((m) => m.id === id1),
      players[3].queue.find((m) => m.id === id2),
    ];
    assert.equal(outcomes.filter((m) => m.type === "ack").length, 1);
    assert.equal(outcomes.filter((m) => m.type === "error").length, 1);
    await players[2].wait((c) => c.state.table.game.phase === "counter");
    v = players[2].state.table.game.version;
    await players[1].command(
      "action",
      { version: v, action: { type: "surcounter" } },
      "error",
    );
    await players[2].command("action", {
      version: v,
      action: { type: "surcounter" },
    });
    await players[0].wait((c) => c.state.table.game.multiplier === 4);
    v = players[0].state.table.game.version;
    const card = players[0].state.table.game.legal[0];
    const requestId = players[0].send(
      "action",
      { version: v, action: { type: "play", card } },
      "play-once",
    );
    await players[0].wait((c) => c.queue.some((m) => m.id === requestId));
    players[0].send(
      "action",
      { version: v, action: { type: "play", card } },
      "play-once",
    );
    await players[0].wait(
      (c) => c.queue.filter((m) => m.id === "play-once").length === 2,
    );
    assert.equal(
      players[0].queue.filter((m) => m.id === "play-once")[1].duplicate,
      true,
    );
    assert.equal(players[0].state.table.game.hand.length, 7);
    const cookie = players[0].cookie;
    players[0].ws.close();
    await delay(20);
    const re = await f.client(cookie);
    assert.equal(re.state.player.id, players[0].state.player.id);
    assert.deepEqual(
      re.state.table.game.hand,
      players[0].state.table.game.hand,
    );
    assert.equal(re.state.table.game.multiplier, 4);
    await re.command(
      "action",
      {
        version: re.state.table.game.version,
        action: { type: "play", card: players[1].state.table.game.hand[0] },
        seat: 1,
      },
      "error",
    );
  } finally {
    await f.close();
  }
});
test("VIP : invitation, mot de passe, admission, confidentialité du lobby et options verrouillées", async () => {
  const f = await fixture();
  try {
    const owner = await f.client(),
      guest = await f.client(),
      outsider = await f.client();
    await owner.command("create", {
      name: "Privée",
      vip: true,
      password: "mot secret",
      rules: { target: 500 },
    });
    const t = owner.state.table;
    assert.ok(t.invite);
    assert.equal(
      outsider.state.tables.some((x) => x.id === t.id),
      false,
    );
    await guest.command(
      "join",
      { tableId: t.id, invite: "faux", password: "mot secret" },
      "error",
    );
    await guest.command(
      "join",
      { tableId: t.id, invite: t.invite, password: "faux" },
      "error",
    );
    assert.equal(guest.state.table, null);
    await guest.command("join", {
      tableId: t.id,
      invite: t.invite,
      password: "mot secret",
    });
    assert.equal(guest.state.table, null);
    await owner.wait((c) => c.state.table.pending.length === 1);
    await outsider.command(
      "admit",
      { playerId: guest.state.player.id },
      "error",
    );
    await owner.command("admit", { playerId: guest.state.player.id, seat: 2 });
    await guest.wait((c) => c.state.table);
    assert.equal("invite" in guest.state.table, false);
    assert.equal("password" in guest.state.table, false);
    assert.equal(guest.state.table.rules.target, 500);
    await owner.command("bot", { seat: 1 });
    await owner.command("bot", { seat: 3 });
    await owner.command("start");
    await owner.command("rules", { rules: { target: 1000 } }, "error");
    await guest.command(
      "action",
      {
        version: guest.state.table.game.version,
        action: { type: "bid", amount: 80, suit: "S" },
        seat: 0,
      },
      "error",
    );
  } finally {
    await f.close();
  }
});
test("une partie complète connectée contre trois robots et statistiques persistées", async () => {
  const f = await fixture();
  try {
    const p = await f.client();
    await p.command("practice", { rules: { target: 100 } });
    let steps = 0;
    while (p.state.table.game.phase !== "finished" && steps++ < 400) {
      const g = p.state.table.game;
      if (g.phase === "summary") {
        await p.command("next");
        continue;
      }
      if (g.turn === 0) {
        const action =
          g.phase === "bidding"
            ? g.contract
              ? { type: "pass" }
              : { type: "bid", amount: 80, suit: "S" }
            : g.phase === "playing"
              ? { type: "play", card: g.legal[0] }
              : null;
        if (action) await p.command("action", { version: g.version, action });
        else await delay(15);
      } else await delay(15);
    }
    assert.equal(p.state.table.game.phase, "finished");
    assert.equal(p.state.table.game.history[0].tricks.length, 8);
    assert.equal(p.state.player.stats.games, 1);
    assert.equal(p.state.player.history.length, 1);
    await p.command("rematch");
    assert.equal(p.state.table.game.phase, "bidding");
    assert.deepEqual(p.state.table.game.scores, [0, 0]);
  } finally {
    await f.close();
  }
});
test("restauration après redémarrage serveur, cookie conservé et état complet", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "belote-restore-"));
  let app = createApp({ dataDir: dir, tickMs: 100000 });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(base + "/api/session", { method: "POST" });
  const cookie = response.headers.get("set-cookie").split(";")[0];
  let ws = new WebSocket(base.replace("http", "ws") + "/ws", {
    headers: { Cookie: cookie },
  });
  let state;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "state") state = m;
  });
  for (let i = 0; !state && i < 100; i++) await delay(5);
  ws.send(JSON.stringify({ id: "practice", type: "practice", data: {} }));
  for (let i = 0; !state.table && i < 100; i++) await delay(5);
  const old = structuredClone(state);
  await app.close();
  try {
    app = createApp({ dataDir: dir, tickMs: 100000 });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    state = null;
    ws = new WebSocket(base.replace("http", "ws") + "/ws", {
      headers: { Cookie: cookie },
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "state") state = m;
    });
    for (let i = 0; !state && i < 100; i++) await delay(5);
    assert.deepEqual(state.table.game, old.table.game);
    assert.equal(state.player.id, old.player.id);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP : application disponible, origine hostile bloquée, administration authentifiée", async () => {
  const f = await fixture({ adminKey: "test-admin-key" });
  try {
    assert.equal((await fetch(f.base + "/api/health")).status, 200);
    const index = await fetch(f.base);
    assert.match(await index.text(), /Belote Prestige/);
    const svg = await fetch(f.base + "/cards/QH.svg");
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");
    assert.equal((await fetch(f.base + "/cards-LICENSE.txt")).status, 200);
    assert.equal((await fetch(f.base + "/cards/../src/server.js")).status, 404);
    assert.equal((await fetch(f.base + "/cards/6H.svg")).status, 404);
    assert.equal(
      (
        await fetch(f.base + "/api/session", {
          method: "POST",
          headers: { Origin: "https://hostile.example" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(f.base + "/api/admin")).status, 403);
    assert.equal((await fetch(f.base + "/admin")).status, 200);
    assert.equal(
      (
        await fetch(f.base + "/api/admin", {
          headers: { Authorization: "Bearer test-admin-key" },
        })
      ).status,
      200,
    );
    const p = await f.client();
    await p.command("report", { reason: "Problème de table" });
    let res = await fetch(f.base + "/api/admin", {
      headers: { Authorization: "Bearer test-admin-key" },
    });
    const data = await res.json();
    assert.equal(data.reports[0].reason, "Problème de table");
    res = await fetch(f.base + "/api/admin", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "maintenance", enabled: true }),
    });
    assert.equal(res.status, 200);
    await p.command("create", { name: "Test" }, "error");
  } finally {
    await f.close();
  }
});
test("enchère concurrente à une contre : une seule action, contrat cohérent", async () => {
  const f = await fixture();
  try {
    const players = await Promise.all(
      Array.from({ length: 4 }, () => f.client()),
    );
    const tableId = players[0].state.tables[0].id;
    for (const p of players) await p.command("join", { tableId });
    // Table publique permanente : départ automatique dès le quatrième joueur assis.
    await players[0].wait((c) => c.state.table?.game);
    await players[3].wait((c) => c.state.table?.game);
    await players[0].command("action", {
      version: players[0].state.table.game.version,
      action: { type: "bid", amount: 80, suit: "S" },
    });
    await players[3].wait((c) => c.state.table.game.contract?.amount === 80);
    const version = players[3].state.table.game.version;
    const a = players[1].send("action", {
        version,
        action: { type: "bid", amount: 90, suit: "H" },
      }),
      b = players[3].send("action", { version, action: { type: "counter" } });
    await players[1].wait((c) => c.queue.some((m) => m.id === a));
    await players[3].wait((c) => c.queue.some((m) => m.id === b));
    const out = [
      players[1].queue.find((m) => m.id === a),
      players[3].queue.find((m) => m.id === b),
    ];
    assert.equal(out.filter((m) => m.type === "ack").length, 1);
    assert.equal(out.filter((m) => m.type === "error").length, 1);
    const g = players[3].state.table.game;
    if (g.phase === "counter") {
      assert.equal(g.contract.amount, 80);
      assert.equal(g.multiplier, 2);
    } else {
      assert.equal(g.contract.amount, 90);
      assert.equal(g.contract.suit, "H");
      assert.equal(g.multiplier, 1);
    }
  } finally {
    await f.close();
  }
});
test("expiration surcontre, tours expirés et remplacement après absence", async () => {
  const f = await fixture();
  try {
    const players = await Promise.all(
      Array.from({ length: 4 }, () => f.client()),
    );
    const tableId = players[0].state.tables[0].id;
    for (const p of players) await p.command("join", { tableId });
    // Table publique permanente : départ automatique dès le quatrième joueur assis.
    await players[0].wait((c) => c.state.table?.game);
    await players[3].wait((c) => c.state.table?.game);
    await players[0].command("action", {
      version: players[0].state.table.game.version,
      action: { type: "bid", amount: 80, suit: "S" },
    });
    await players[3].wait((c) => c.state.table.game.contract?.amount === 80);
    await players[3].command("action", {
      version: players[3].state.table.game.version,
      action: { type: "counter" },
    });
    const t = f.app.db.tables[tableId];
    t.game.counterDeadline = Date.now() - 1;
    await players[0].wait((c) => c.state.table.game.phase === "playing");
    // Temps écoulé : la carte autorisée la plus forte est jouée à la place du joueur.
    const card = strongestCard(players[0].state.table.game.legal, t.game.contract.suit);
    t.deadline = Date.now() - 1;
    await players[1].wait((c) => c.state.table.game.handCounts[0] === 7);
    assert.equal(players[1].state.table.game.trick[0].card, card);
    players[1].ws.close();
    await players[0].wait((c) => !c.state.table.seats[1].connected);
    t.seats[1].disconnectedAt = Date.now() - 100000;
    t.botAt = 0;
    await players[0].wait((c) => c.state.table.game.handCounts[1] === 7);
    assert.equal(t.seats[1].id, players[1].state.player.id);
    const re = await f.client(players[1].cookie);
    assert.equal(re.state.table.game.hand.length, 7);
    assert.equal(re.state.table.seats[1].connected, true);
  } finally {
    await f.close();
  }
});
test("admin : traitement, suspension, réactivation et suppression limitée aux tables inactives", async () => {
  const f = await fixture({ adminKey: "test-admin" });
  try {
    const p = await f.client();
    await p.command("report", { reason: "test" });
    await p.command("create", { name: "À retirer", vip: true });
    const tableId = p.state.table.id;
    const admin = async (data) => {
      const r = await fetch(f.base + "/api/admin", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      assert.equal(r.status, 200);
      return r.json();
    };
    const d = await admin({ type: "resolve", id: f.app.db.reports[0].id });
    assert.equal(d.reports[0].resolved, true);
    await admin({ type: "deleteTable", id: tableId });
    await p.wait((c) => !c.state.table);
    await admin({ type: "suspend", id: p.state.player.id, enabled: true });
    const blocked = await fetch(f.base + "/api/session", {
      method: "POST",
      headers: { Cookie: p.cookie },
    });
    assert.equal(blocked.status, 403);
    await admin({ type: "suspend", id: p.state.player.id, enabled: false });
    assert.equal(
      (
        await fetch(f.base + "/api/session", {
          method: "POST",
          headers: { Cookie: p.cookie },
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("choix des équipes par le créateur, refus des autres joueurs et gel au lancement", async () => {
  const f = await fixture();
  try {
    const owner = await f.client(),
      guest = await f.client();
    const tableId = owner.state.tables[0].id;
    await owner.command("join", { tableId });
    await guest.command("join", { tableId });
    await guest.command("move", { from: 1, to: 2 }, "error");
    await owner.command("move", { from: 1, to: 2 });
    await guest.wait((c) => c.state.table.seats[2]?.id === c.state.player.id);
    assert.equal(guest.state.table.seats[1], null);
    await owner.command("bot", { seat: 1 });
    await owner.command("bot", { seat: 3 });
    await owner.command("start");
    await owner.command("move", { from: 0, to: 1 }, "error");
  } finally {
    await f.close();
  }
});
async function api(f, cookie, route, body) {
  const r = await fetch(f.base + route, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: f.base },
    body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body ?? {}),
  });
  const set = r.headers.get("set-cookie");
  return { status: r.status, body: await r.json(), cookie: set ? set.split(";")[0] : cookie };
}
test("comptes : inscription, vérification, connexion sur un autre appareil, réinitialisation, suppression", async () => {
  const f = await fixture();
  try {
    const guest = await fetch(f.base + "/api/session", { method: "POST" });
    let cookie = guest.headers.get("set-cookie").split(";")[0];
    const guestId = (await guest.json()).id;
    let r = await api(f, cookie, "/api/auth/register", { email: "Sophie@Exemple.fr", password: "court" });
    assert.equal(r.status, 400);
    r = await api(f, cookie, "/api/auth/register", { email: "Sophie@Exemple.fr", password: "motdepasse1" });
    assert.equal(r.status, 200);
    assert.equal(r.body.id, guestId, "le profil invité devient le compte");
    assert.deepEqual(r.body.account, { email: "sophie@exemple.fr", verified: false, providers: [], hasPassword: true });
    const link = /\/api\/auth\/verify\?token=\S+/.exec(f.app.db.outbox.at(-1).text)[0];
    const v = await fetch(f.base + link, { redirect: "manual" });
    assert.equal(v.headers.get("location"), "/#verified");
    assert.equal((await fetch(f.base + link, { redirect: "manual" })).headers.get("location"), "/#verify-failed");
    // Deuxième appareil : nouvel invité qui se connecte → même profil, ses parties sont reprises.
    const other = await fetch(f.base + "/api/session", { method: "POST" });
    const otherCookie = other.headers.get("set-cookie").split(";")[0];
    f.app.db.players[(await other.json()).id].stats.games = 2;
    assert.equal((await api(f, otherCookie, "/api/auth/login", { email: "sophie@exemple.fr", password: "mauvais!!" })).status, 401);
    r = await api(f, otherCookie, "/api/auth/login", { email: "sophie@exemple.fr", password: "motdepasse1" });
    assert.equal(r.body.id, guestId);
    assert.equal(r.body.account.verified, true);
    assert.equal(r.body.stats.games, 2);
    const ws = await f.client(r.cookie);
    assert.equal(ws.state.player.id, guestId);
    // Mot de passe oublié : réponse identique pour une adresse inconnue.
    assert.equal((await api(f, "", "/api/auth/forgot", { email: "inconnu@exemple.fr" })).status, 200);
    await api(f, "", "/api/auth/forgot", { email: "sophie@exemple.fr" });
    const reset = /#reset=(\S+)/.exec(f.app.db.outbox.at(-1).text)[1];
    r = await api(f, "", "/api/auth/reset", { token: reset, password: "nouveau-mdp" });
    assert.equal(r.body.id, guestId);
    assert.equal((await api(f, "", "/api/auth/reset", { token: reset, password: "nouveau-mdp" })).status, 400);
    assert.equal((await fetch(f.base + "/api/session", { method: "POST", headers: { Cookie: cookie } }).then((x) => x.json())).id !== guestId, true, "anciennes sessions révoquées");
    cookie = r.cookie;
    // Connexion Apple/Google sans configuration : refus explicite.
    assert.equal((await api(f, cookie, "/api/auth/oidc", { provider: "google", idToken: "x.y.z" })).status, 501);
    // Suppression du compte.
    assert.equal((await api(f, cookie, "/api/auth/delete", { password: "faux-mdp!" })).status, 401);
    r = await api(f, cookie, "/api/auth/delete", { password: "nouveau-mdp" });
    assert.equal(r.status, 200, r.body.error);
    assert.notEqual(r.body.id, guestId);
    assert.equal(f.app.db.players[guestId], undefined);
    assert.equal(Object.keys(f.app.db.accounts).length, 0);
  } finally {
    await f.close();
  }
});
test("profil : pseudo, avatar illustré, photo recadrée", async () => {
  const f = await fixture();
  try {
    const c = await f.client();
    await c.command("profile", { name: "Sophie", avatar: "chat" });
    await c.wait((c) => c.state.player.avatar === "chat");
    await c.command("profile", { avatar: "♠" }, "error");
    await c.command("profile", { name: "x" }, "error");
    const jpeg = new Uint8Array(200).fill(1);
    jpeg.set([0xff, 0xd8, 0xff]);
    assert.equal((await api(f, c.cookie, "/api/avatar", new Uint8Array([1, 2, 3]))).status, 400);
    const r = await api(f, c.cookie, "/api/avatar", jpeg);
    assert.match(r.body.avatar, /^u:[0-9a-f]{32}$/);
    const img = await fetch(`${f.base}/u/${r.body.avatar.slice(2)}.jpg`);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    assert.equal((await fetch(f.base + "/avatars/chien.webp")).status, 200);
    assert.equal((await fetch(f.base + "/avatars/inconnu.svg")).status, 404);
  } finally {
    await f.close();
  }
});
test("jouer maintenant : humains regroupés, robots ajoutés après le délai", async () => {
  const f = await fixture({ fillSeconds: 0.3 });
  try {
    const a = await f.client(),
      b = await f.client();
    await a.command("quick");
    await b.command("quick");
    await a.wait((c) => c.state.table?.seats.filter(Boolean).length === 2);
    assert.equal(a.state.table.id, b.state.table.id);
    assert.equal(a.state.table.quick, true);
    assert.equal(a.state.table.game, null);
    await a.wait((c) => c.state.table?.game);
    const seats = a.state.table.seats;
    assert.equal(seats.filter((s) => s.bot).length, 2);
    assert.equal(seats.filter((s) => !s.bot).length, 2);
  } finally {
    await f.close();
  }
});
test("quitter la partie : un robot reprend la main, les autres continuent", async () => {
  const f = await fixture({ botDelay: 100000 });
  try {
    const players = await Promise.all(Array.from({ length: 4 }, () => f.client()));
    const t = players[0].state.tables[0];
    for (const p of players) await p.command("join", { tableId: t.id });
    // Table publique permanente : départ automatique dès le quatrième joueur assis.
    await players[0].wait((c) => c.state.table?.game);
    await players[1].wait((c) => c.state.table?.game);
    const before = players[1].state.table.game;
    const hand = f.app.db.tables[t.id].game.hands[1].slice();
    await players[1].command("leave");
    await players[1].wait((c) => !c.state.table);
    await players[0].wait((c) => c.state.table.seats[1].bot);
    const seat = players[0].state.table.seats[1];
    assert.equal(seat.replaced, players[1].state.player.name);
    const g = f.app.db.tables[t.id].game;
    assert.deepEqual(g.hands[1], hand, "main conservée");
    assert.deepEqual(g.scores, before.scores);
    // Le robot joue à son tour.
    while (g.turn !== 1) {
      const p = players[g.turn];
      await p.command("action", { version: g.version, action: { type: "pass" } });
    }
    const v = g.version;
    f.app.db.tables[t.id].botAt = 0;
    await players[0].wait(() => g.version > v);
    // Plus aucun humain : la table publique est remise à zéro.
    for (const i of [0, 2, 3]) await players[i].command("leave");
    await players[0].wait((c) => !c.state.table && c.state.tables.every((x) => x.status === "En attente"));
  } finally {
    await f.close();
  }
});
async function member(f, email) {
  const s = await fetch(f.base + "/api/session", { method: "POST" });
  const cookie = s.headers.get("set-cookie").split(";")[0];
  const r = await api(f, cookie, "/api/auth/register", { email, password: "motdepasse" });
  return f.client(r.cookie);
}
test("crédits : table à 200, réservations, achat en cours, départ, règlement unique et équilibré", async () => {
  const { createHmac } = await import("node:crypto");
  const env = { BELOTE_TEST_SHOP: "on", BELOTE_PURCHASES: "on", STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "whsec", BELOTE_LOGIN_BONUS: "0" };
  const f = await fixture({ env, botDelay: 1 });
  try {
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await member(f, `j${i}@exemple.fr`));
    assert.equal(ps[0].state.player.wallet.balance, 4000, "2000 crédits offerts (en demi-crédits)");
    // Un invité ne peut pas miser.
    const guest = await f.client();
    await ps[0].command("create", { name: "Table 200", vip: false, stake: 200, rules: { target: 100 } });
    const table = ps[0].state.table.id;
    await guest.command("join", { tableId: table }, "error");
    await ps[0].command("bot", { seat: 1 }, "error");
    for (const p of ps.slice(1)) await p.command("join", { tableId: table });
    await ps[0].wait((c) => c.state.table.engagedPreview?.every((x) => x?.engaged === 200));
    await ps[0].command("start");
    await ps[3].wait((c) => c.state.table?.game);
    const db = f.app.db;
    for (const p of ps) assert.equal(db.players[p.state.player.id].wallet.reserved, 400);
    assert.deepEqual(ps[0].state.table.money.seats.map((x) => x.engaged), [200, 200, 200, 200]);
    // Le joueur 1 achète des crédits pendant la partie : sa mise engagée ne change pas.
    const buy = await api(f, ps[1].cookie, "/api/shop/test", { pack: "pack-1000", transactionId: "tx-1" });
    assert.equal(buy.body.credited, true);
    assert.equal((await api(f, ps[1].cookie, "/api/shop/test", { pack: "pack-1000", transactionId: "tx-1" })).body.credited, false, "transaction rejouée ignorée");
    // Notification Stripe reçue deux fois : créditée une seule fois.
    const pid2 = ps[2].state.player.id;
    const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", client_reference_id: pid2, metadata: { pack: "pack-3000" } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", "whsec").update(`${t}.${raw}`).digest("hex")}`;
    for (let i = 0; i < 2; i++)
      assert.equal((await fetch(f.base + "/api/shop/stripe-webhook", { method: "POST", headers: { "Stripe-Signature": sig }, body: raw })).status, 200);
    assert.equal(db.ledger.filter((x) => x.key === "purchase:stripe:cs_1").length, 1);
    assert.equal((await fetch(f.base + "/api/shop/stripe-webhook", { method: "POST", headers: { "Stripe-Signature": "t=1,v1=00" }, body: raw })).status, 401);
    // Tout le monde quitte : chacun perd sa mise tout de suite, les robots de la Maison finissent la partie.
    for (const p of ps) await p.command("leave");
    const tb = db.tables[table];
    await ps[0].wait(() => tb.game?.phase === "finished");
    assert.equal(tb.money.settled, true);
    const deltas = db.ledger.filter((x) => x.gameId === tb.gameId).map((x) => x.amount);
    assert.deepEqual(deltas, [-400, -400, -400, -400]);
    for (const p of ps) {
      const w = db.players[p.state.player.id].wallet;
      assert.equal(w.reserved, 0);
      assert.ok(w.balance >= 0);
    }
    const hist = await ps[0].command("wallet");
    assert.ok(hist.wallet.some((x) => x.gameId === tb.gameId && x.stake === 200 && x.label === "Abandon de la partie"));
  } finally {
    await f.close();
  }
});
test("crédits : annulation technique par l'administration, sans gain ni perte", async () => {
  const f = await fixture({ adminKey: "k", botDelay: 100000, env: { BELOTE_LOGIN_BONUS: "0" } });
  try {
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await member(f, `a${i}@exemple.fr`));
    await ps[0].command("create", { name: "T", vip: false, stake: 1000 });
    for (const p of ps.slice(1)) await p.command("join", { tableId: ps[0].state.table.id });
    await ps[0].command("start");
    const id = ps[0].state.table.id;
    const r = await fetch(f.base + "/api/admin", { method: "POST", headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: JSON.stringify({ type: "cancelGame", id }) });
    assert.equal(r.status, 200);
    for (const p of ps) {
      const w = f.app.db.players[p.state.player.id].wallet;
      assert.deepEqual([w.balance, w.reserved], [4000, 0]);
    }
  } finally {
    await f.close();
  }
});
test("social : amis, invitation sans engagement, blocage, réactions limitées, chat prédéfini en partie", async () => {
  const f = await fixture({ reactionCooldownMs: 300, botDelay: 100000 });
  try {
    const a = await member(f, "a@x.fr"),
      b = await member(f, "b@x.fr"),
      c = await f.client();
    await a.command("profile", { name: "Alice" });
    const found = await b.command("search", { q: a.state.player.tag });
    const alice = found.found[0];
    assert.equal(alice.name, "Alice");
    await b.command("friendRequest", { id: alice.id });
    await a.wait((x) => x.state.player.friendIn.length === 1);
    await a.command("friendAccept", { id: b.state.player.id });
    await b.wait((x) => x.state.player.friends[0]?.status === "available");
    await b.command("favorite", { id: alice.id, on: true });
    // Invitation : précise table, mise, règles ; aucun crédit réservé.
    await a.command("create", { name: "Salon VIP", vip: true, stake: 100 });
    await a.command("invite", { id: b.state.player.id });
    await b.wait((x) => x.state.player.invites.length === 1);
    const inv = b.state.player.invites[0];
    assert.deepEqual([inv.table, inv.stake, inv.free], ["Salon VIP", 100, 3]);
    assert.equal(f.app.db.players[b.state.player.id].wallet.reserved, 0);
    await c.command("invite", { id: a.state.player.id }, "error"); // c n'est à aucune table
    await b.command("inviteAccept", { id: inv.id });
    await b.wait((x) => x.state.table?.name === "Salon VIP");
    // Blocage : plus de demandes ni d'invitations.
    await c.command("friendRequest", { id: a.state.player.id });
    await a.command("block", { id: c.state.player.id, on: true });
    await c.command("friendRequest", { id: a.state.player.id }, "error");
    assert.equal(f.app.db.players[a.state.player.id].friendIn.length, 0);
    // Réactions : délai entre deux réactions.
    await a.command("react", { id: "bravo" });
    await a.command("react", { id: "merci" }, "error");
    await delay(320);
    await a.command("react", { id: "merci" });
    // Pendant la partie, messages prédéfinis uniquement.
    await a.command("rules", { rules: {}, stake: 0 });
    await a.command("bot", { seat: 2 });
    await a.command("bot", { seat: 3 });
    await a.command("start");
    await a.command("chat", { text: "j'ai le valet" }, "error");
    await a.command("chat", { text: "Bien joué !" });
    // Signalement avec contexte de partie.
    await b.command("report", { target: a.state.player.id, category: "cheat", comment: "test" });
    const rep = f.app.db.reports.at(-1);
    assert.equal(rep.gameId, f.app.db.tables[a.state.player && b.state.table.id].gameId);
    assert.equal(rep.reason, "Suspicion de triche ou d’arrangement");
    // Les mains adverses ne sont jamais transmises.
    const g = b.state.table.game;
    assert.equal(g.hand.length, 8);
    assert.equal(JSON.stringify(b.state).includes('"hands"'), false);
  } finally {
    await f.close();
  }
});
test("revanche : chaque joueur confirme, nouvelles réservations, refus = retour au salon", async () => {
  const f = await fixture({ botDelay: 1 });
  try {
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await member(f, `r${i}@x.fr`));
    await ps[0].command("create", { name: "R", vip: false, stake: 100, rules: { target: 100 } });
    for (const p of ps.slice(1)) await p.command("join", { tableId: ps[0].state.table.id });
    await ps[0].command("start");
    const t = f.app.db.tables[ps[0].state.table.id];
    // Les quatre joueurs jouent la partie jusqu'au bout.
    for (let guard = 0; t.game.phase !== "finished" && guard < 2000; guard++) {
      const g = t.game;
      if (g.phase === "summary") await ps[0].command("next");
      else if (g.phase === "counter") await delay(5);
      else {
        const v = view(g, g.turn);
        const action = g.phase === "bidding" ? (g.contract ? { type: "pass" } : { type: "bid", amount: 80, suit: "S" }) : { type: "play", card: v.legal[0] };
        await ps[g.turn].command("action", { version: g.version, action });
      }
    }
    for (let i = 0; i < 3; i++) await ps[i].command("rematchVote", { accept: true });
    assert.equal(t.game.phase, "finished", "pas de lancement sans les quatre accords");
    assert.equal(Object.keys(t.rematch.votes).length, 3);
    assert.equal(f.app.db.players[ps[3].state.player.id].wallet.reserved, 0);
    await ps[3].command("rematchVote", { accept: true });
    assert.equal(t.game.phase, "bidding");
    assert.ok(t.money && !t.money.settled);
    for (const p of ps) assert.equal(f.app.db.players[p.state.player.id].wallet.reserved, 200);
    // Fin de la revanche puis refus : retour au salon.
    f.app.db.tables[t.id].game.phase = "finished";
    await ps[1].command("rematchVote", { accept: false });
    assert.equal(t.game, null);
  } finally {
    await f.close();
  }
});
test("roue du jour : rien d'automatique, un seul tour par 24 h sur tous les appareils, série", async () => {
  const f = await fixture({ adminKey: "k", env: { BELOTE_SIGNUP_BONUS: "1000" } });
  try {
    const phone = await member(f, "bonus@exemple.fr");
    const id = phone.state.player.id;
    // Plus de bonus versé à la connexion : la roue attend le joueur.
    assert.equal(phone.state.player.wallet.balance, 2000);
    assert.ok(phone.state.player.wallet.loginBonus.next <= Date.now());
    const s = await fetch(f.base + "/api/session", { method: "POST" });
    const login = await api(f, s.headers.get("set-cookie").split(";")[0], "/api/auth/login", { email: "bonus@exemple.fr", password: "motdepasse" });
    const desk = await f.client(login.cookie);
    const r1 = await phone.command("spin");
    assert.ok(r1.segment >= 0 && r1.segment < 8 && r1.amount > 0 && r1.streak === 1);
    await desk.command("spin", {}, "error"); // autre appareil : déjà tournée
    assert.equal(f.app.db.ledger.filter((x) => x.pid === id && x.type === "login").length, 1);
    // Le lendemain : deuxième jour de série.
    f.app.db.players[id].loginBonusAt -= 24 * 3600_000;
    const r2 = await desk.command("spin");
    assert.equal(r2.streak, 2);
    assert.equal(f.app.db.ledger.filter((x) => x.pid === id && x.type === "login").length, 2);
    // Base réglée dans l'administration.
    const r = await fetch(f.base + "/api/admin", { method: "POST", headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: JSON.stringify({ type: "loginBonus", amount: 350 }) });
    assert.equal(r.status, 200);
    assert.equal(f.app.db.settings.loginBonus, 350);
  } finally {
    await f.close();
  }
});
test("tournoi programmé : départ automatique, vraies tables sans robots, forfait sur absence prolongée", async () => {
  let offset = 0;
  const f = await fixture({ adminKey: "k", clock: () => Date.now() + offset, env: { BELOTE_SIGNUP_BONUS: "60000", BELOTE_LOGIN_BONUS: "0" } });
  try {
    const admin = (body) => fetch(f.base + "/api/admin", { method: body ? "POST" : "GET", headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => [r.status, r.status === 200 ? await r.json() : await r.text()]);
    const H = 3600_000;
    const local = (ms) => new Date(ms + 0).toISOString().slice(0, 16); // fuseau UTC pour ce test
    const now = Date.now();
    const data = { name: "Coupe du jeudi", timeZone: "UTC", teams: 8, minTeams: 2, minBalance: 50000, rules: { target: 500, turnSeconds: 20, flyingCounter: true }, rewards: { winner: ["tournoi-vainqueur"], participant: ["tournoi-participant"] }, regOpen: local(now + H), regClose: local(now + 2 * H), confirmBy: local(now + 3 * H - 10 * 60_000), start: local(now + 3 * H), publish: true };
    // Les dates incohérentes sont refusées par le serveur.
    assert.equal((await admin({ type: "tourCreate", data: { ...data, confirmBy: local(now + 4 * H) } }))[0], 400);
    const [status, view] = await admin({ type: "tourCreate", data });
    assert.equal(status, 200);
    const tid = view.tournaments[0].id;
    // Suppression réservée aux anciens tournois : refusée tant qu'il est publié.
    assert.equal((await admin({ type: "tourDelete", id: tid }))[0], 400);
    const [, v2] = await admin({ type: "tourCreate", data: { ...data, name: "Coupe à jeter", publish: false } });
    const old = v2.tournaments.find((x) => x.name === "Coupe à jeter");
    const [okDel, v3] = await admin({ type: "tourDelete", id: old.id });
    assert.equal(okDel, 200);
    assert.ok(!v3.tournaments.some((x) => x.id === old.id), "brouillon supprimé");
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await member(f, `t${i}@exemple.fr`));
    await ps[0].wait((c) => c.state.tournaments?.length === 1);
    assert.equal(ps[0].state.tournaments[0].stage, "soon");
    await ps[0].command("tourRegister", { id: tid }, "error");
    offset = H + 1000; // ouverture programmée
    await ps[0].wait((c) => c.state.tournaments[0].stage === "open");
    for (const p of ps) await p.command("tourRegister", { id: tid });
    assert.ok(ps[0].state.player.inbox.some((n) => /Inscription confirmée/.test(n.title)));
    offset = 3 * H - 9.5 * 60_000; // fenêtre de présence (l'échéance est passée de 30 s : on teste le refus)
    await ps[0].command("tourConfirm", { id: tid }, "error");
    offset = 3 * H - 12 * 60_000;
    for (const p of ps) await p.command("tourConfirm", { id: tid });
    offset = 3 * H + 1000; // départ automatique : aucun administrateur connecté
    for (const p of ps) await p.wait((c) => c.state.table?.game && c.state.table.tournament?.id === tid);
    const t = ps[0].state.table;
    assert.equal(t.seats.filter((s) => s.bot).length, 0, "aucun robot en tournoi");
    await ps[0].wait((c) => c.state.player.inbox.some((n) => n.title === "Votre table est prête, rejoignez la partie !"));
    // Revanche impossible, la suite se joue au tour suivant.
    // Coupure longue d'un joueur de l'équipe impaire : forfait au-delà du délai annoncé.
    const db = f.app.db;
    const quitter = ps.find((p) => db.tables[t.id].seats.findIndex((s) => s.id === p.state.player.id) === 1);
    const watcher = ps.find((p) => p !== quitter);
    quitter.ws.close();
    for (let i = 0; i < 100 && !db.tables[t.id].seats[1].disconnectedAt; i++) await delay(10);
    db.tables[t.id].seats[1].disconnectedAt = Date.now() - 301_000;
    await watcher.wait((c) => c.state.tournaments[0].status === "finished");
    const tour = db.tournaments[tid];
    assert.equal(tour.rounds[0].find((m) => m.tableId === t.id).status, "forfeit");
    const champ = tour.teamsList.find((x) => x.id === tour.champion);
    assert.ok(!champ.pids.includes(quitter.state.player.id));
    for (const pid of champ.pids) assert.ok(db.players[pid].progress.badges["tournoi-vainqueur"]);
    assert.ok(db.players[quitter.state.player.id].progress.badges["tournoi-participant"]);
    assert.equal(db.tables[t.id], undefined, "table de la rencontre fermée");
    const [, after] = await admin();
    assert.ok(after.tournaments[0].log.some((l) => l.kind === "forfait"));
  } finally {
    await f.close();
  }
});
test("tournoi : reconnexion dans le délai sans pénalité, abandon = forfait, notifications push enregistrées", async () => {
  let offset = 0;
  const f = await fixture({ adminKey: "k", clock: () => Date.now() + offset, env: { BELOTE_SIGNUP_BONUS: "60000", BELOTE_LOGIN_BONUS: "0" } });
  try {
    const H = 3600_000;
    const local = (ms) => new Date(ms).toISOString().slice(0, 16);
    const now = Date.now();
    const data = { name: "Coupe du vendredi", timeZone: "UTC", teams: 8, minTeams: 2, minBalance: 50000, rules: { target: 500, turnSeconds: 20 }, regOpen: local(now - H), regClose: local(now + H), confirmBy: local(now + 2 * H - 10 * 60_000), start: local(now + 2 * H), publish: true };
    await fetch(f.base + "/api/admin", { method: "POST", headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: JSON.stringify({ type: "tourCreate", data }) });
    const tid = Object.keys(f.app.db.tournaments)[0];
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await member(f, `r${i}@exemple.fr`));
    // Abonnement push d'un navigateur : validé et conservé côté serveur.
    const bad = await api(f, ps[0].cookie, "/api/push/subscribe", { type: "web", subscription: { endpoint: "http://non-securise" } });
    assert.equal(bad.status, 400);
    const ok = await api(f, ps[0].cookie, "/api/push/subscribe", { type: "web", subscription: { endpoint: "https://push.exemple/1", keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } } });
    assert.equal(ok.status, 200);
    assert.equal(f.app.db.players[ps[0].state.player.id].push.web.length, 1);
    for (const p of ps) await p.command("tourRegister", { id: tid });
    offset = 2 * H - 12 * 60_000;
    for (const p of ps) await p.command("tourConfirm", { id: tid });
    offset = 2 * H + 1000;
    for (const p of ps) await p.wait((c) => c.state.table?.game);
    const t = f.app.db.tables[ps[0].state.table.id];
    // Coupure courte : la place est gardée, aucun robot, pas de forfait.
    const who = ps.find((p) => t.seats[2].id === p.state.player.id);
    who.ws.close();
    await delay(100);
    t.seats[2].disconnectedAt = Date.now() - 60_000;
    await delay(1200);
    assert.equal(f.app.db.tournaments[tid].status, "running");
    const back = await f.client(who.cookie);
    assert.equal(back.state.table.id, t.id, "reconnexion : retour à la même table");
    assert.equal(t.seats[2].bot, undefined);
    // Abandon volontaire d'un joueur de l'équipe paire : forfait immédiat.
    await ps.find((p) => t.seats[0].id === p.state.player.id).command("leave");
    await back.wait((c) => c.state.tournaments[0].status === "finished");
    const tour = f.app.db.tournaments[tid];
    assert.match(tour.rounds[0][0].forfeit, /Abandon/);
    assert.ok(tour.teamsList.find((x) => x.id === tour.champion).pids.includes(t.seats[1].id));
  } finally {
    await f.close();
  }
});
test("pseudos uniques : inscription et changement de pseudo refusés si déjà pris", async () => {
  const f = await fixture();
  try {
    const a = await member(f, "unique1@exemple.fr");
    await a.command("profile", { name: "Sophie" });
    const b = await member(f, "unique2@exemple.fr");
    const err = await b.command("profile", { name: "  sOphie " }, "error");
    assert.match(err.message, /déjà pris/);
    await b.command("profile", { name: "Sophié" }, "error");
    await b.command("profile", { name: "Sophie B" });
    await a.command("profile", { name: "Sophie" }); // garder son propre pseudo est permis
    const s = await fetch(f.base + "/api/session", { method: "POST" });
    const r = await api(f, s.headers.get("set-cookie").split(";")[0], "/api/auth/register", { email: "unique3@exemple.fr", password: "motdepasse", name: "SOPHIE" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /déjà pris/);
  } finally {
    await f.close();
  }
});
test("connexion : adresse inconnue signalée, mauvais mot de passe distingué", async () => {
  const f = await fixture();
  try {
    await member(f, "connu@exemple.fr");
    const s = await fetch(f.base + "/api/session", { method: "POST" });
    const cookie = s.headers.get("set-cookie").split(";")[0];
    const unknown = await api(f, cookie, "/api/auth/login", { email: "inconnu@exemple.fr", password: "motdepasse" });
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error, /Aucun compte/);
    const wrong = await api(f, cookie, "/api/auth/login", { email: " CONNU@exemple.fr ", password: "mauvais!!" });
    assert.equal(wrong.status, 401);
    assert.match(wrong.body.error, /Mot de passe incorrect/);
    const ok = await api(f, cookie, "/api/auth/login", { email: "Connu@Exemple.fr", password: "motdepasse" });
    assert.equal(ok.status, 200);
  } finally {
    await f.close();
  }
});
test("joueurs en ligne proposés, invitation sans réponse remplacée par des robots", async () => {
  const f = await fixture({ inviteWaitMs: 300, env: { BELOTE_LOGIN_BONUS: "0" } });
  try {
    const a = await member(f, "hote@exemple.fr");
    const b = await member(f, "invite@exemple.fr");
    await b.command("profile", { name: "Bruno" });
    await a.command("create", { name: "Table d'Alice", vip: true, fillBots: true, rules: {} });
    await a.wait((c) => c.state.online?.some((o) => o.name === "Bruno" && !o.invited));
    const bid = b.state.player.id;
    await a.command("invite", { id: bid });
    await b.wait((c) => c.state.player.invites.length === 1);
    await a.wait((c) => c.state.online.find((o) => o.id === bid)?.invited);
    // Bruno ne vient pas : robots et départ automatiques.
    await a.wait((c) => c.state.table.game);
    assert.equal(a.state.table.seats.filter((s) => s?.bot).length, 3);
  } finally {
    await f.close();
  }
});
test("tables permanentes à 200, 500 et 1 000 jetons ; suppression des tables créées", async () => {
  const f = await fixture({ env: { BELOTE_LOGIN_BONUS: "0" } });
  try {
    const a = await member(f, "createur@exemple.fr");
    const stakes = a.state.tables.filter((t) => t.lobby && t.stake).map((t) => t.stake).sort((x, y) => x - y);
    assert.deepEqual(stakes, [200, 500, 1000]);
    await a.command("create", { name: "Ma table publique", vip: false, rules: {} });
    const id = a.state.table.id;
    await a.wait((c) => c.state.player.myTables.some((t) => t.id === id && !t.vip));
    await a.command("leave");
    await a.command("closeTable", { tableId: id });
    await a.wait((c) => !c.state.player.myTables.some((t) => t.id === id));
    assert.equal(f.app.db.tables[id], undefined);
    const lobby = a.state.tables.find((t) => t.lobby);
    await a.command("closeTable", { tableId: lobby.id }, "error"); // les tables permanentes restent
  } finally {
    await f.close();
  }
});
test("mise choisie : joueurs regroupés sans invitation, départ automatique à quatre", async () => {
  const f = await fixture({ env: { BELOTE_LOGIN_BONUS: "0" } });
  try {
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(await member(f, `lobby${i}@exemple.fr`));
    for (const p of ps.slice(0, 3)) await p.command("playLobby", { stake: 500 });
    const id = ps[0].state.table.id;
    for (const p of ps.slice(1, 3)) assert.equal(p.state.table.id, id, "même table");
    assert.equal(ps[0].state.table.game, null);
    await ps[3].command("playLobby", { stake: 500 });
    for (const p of ps) await p.wait((c) => c.state.table?.game && c.state.table.id === id);
    assert.equal(f.app.db.tables[id].money.stake, 1000); // 500 jetons en demi-unités
    // Une nouvelle table à 500 est aussitôt proposée aux suivants.
    await ps[0].wait((c) => c.state.tables.some((t) => t.lobby && t.stake === 500 && t.id !== id && t.available === 4));
    await ps[0].command("playLobby", { stake: 333 }, "error");
  } finally {
    await f.close();
  }
});

test("back office : fiche client, crédits manuels, modification et suppression", async () => {
  const f = await fixture({ adminKey: "test-admin", env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "100" } });
  try {
    const admin = async (data, status = 200) => {
      const r = await fetch(f.base + "/api/admin", {
        method: "POST",
        headers: { Authorization: "Bearer test-admin", "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      assert.equal(r.status, status, await r.clone().text());
      return status === 200 ? r.json() : r.text();
    };
    const a = await member(f, "alice@exemple.fr");
    await member(f, "bob@exemple.fr");
    const id = a.state.player.id;
    const before = f.app.db.players[id].wallet.balance;
    await admin({ type: "playerCredit", id, amount: 250, reason: "Geste" });
    assert.equal(f.app.db.players[id].wallet.balance, before + 500);
    await admin({ type: "playerCredit", id, amount: -50 });
    assert.equal(f.app.db.players[id].wallet.balance, before + 400);
    await admin({ type: "playerCredit", id, amount: -1e6 }, 400);
    const detail = await (await fetch(f.base + "/api/admin?player=" + id, { headers: { Authorization: "Bearer test-admin" } })).json();
    assert.equal(detail.account.email, "alice@exemple.fr");
    assert.equal(detail.ledger[0].amount, -50);
    assert.equal(detail.ledger[1].label, "Geste");
    await admin({ type: "playerUpdate", id, name: "Alicia", email: "bob@exemple.fr" }, 400);
    await admin({ type: "playerUpdate", id, name: "Alicia", email: "alicia@exemple.fr", verified: true });
    assert.equal(f.app.db.players[id].name, "Alicia");
    assert.equal(f.app.db.accounts[f.app.db.players[id].accountId].email, "alicia@exemple.fr");
    const d = await admin({ type: "playerDelete", id });
    assert.ok(!d.players.some((p) => p.id === id));
    assert.ok(!Object.values(f.app.db.accounts).some((x) => x.email === "alicia@exemple.fr"));
  } finally {
    await f.close();
  }
});

test("boutique : achat unique, solde insuffisant, jetons engagés, équipement et emojis", async () => {
  const f = await fixture({ adminKey: "test-admin", env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "1200" } });
  try {
    const a = await member(f, "boutique@exemple.fr");
    const p = f.app.db.players[a.state.player.id];
    assert.equal(p.wallet.balance, 2400);
    // Deux requêtes identiques : un seul débit.
    await a.command("shopBuy", { id: "av-03" });
    await a.command("shopBuy", { id: "av-03" }, "error");
    assert.equal(p.wallet.balance, 400);
    assert.equal(f.app.db.ledger.filter((x) => x.pid === p.id && x.type === "achat").length, 1);
    await a.command("profile", { avatar: "av-03" });
    assert.equal(p.avatar, "av-03");
    await a.command("profile", { avatar: "av-04" }, "error");
    // Solde insuffisant : rien n'est débité.
    const err = await a.command("shopBuy", { id: "dos-vert" }, "error");
    assert.equal(err.code, "shopFunds");
    assert.equal(err.missing, 1300);
    // Jetons engagés en partie : non dépensables.
    p.wallet.balance += 500; // 450 jetons, dont 200 engagés en partie
    p.wallet.reserved = 400;
    await a.command("shopBuy", { id: "emo-01" }, "error");
    p.wallet.reserved = 0;
    await a.command("shopBuy", { id: "emo-01" });
    assert.ok(f.app.db.players[p.id].progress.favorites.includes("emo-01"));
    await a.command("equip", { id: "tapis-rouge" }, "error");
    // Article masqué par l'administration : invisible pour les autres, conservé par son possesseur.
    const r = await fetch(f.base + "/api/admin", { method: "POST", headers: { Authorization: "Bearer test-admin", "Content-Type": "application/json" }, body: JSON.stringify({ type: "shopItem", id: "emo-01", hidden: true, price: 350 }) });
    assert.equal(r.status, 200);
    await a.wait((c) => c.state.player.shop.items.some((x) => x.id === "emo-01" && x.owned));
    assert.equal((await fetch(f.base + "/shop/avatars/av-03.webp")).status, 200);
  } finally {
    await f.close();
  }
});

test("Jouer maintenant : partie à 200 avec les robots de la Maison, gratuite sans crédits", async () => {
  const f = await fixture({ fillSeconds: 0.05, env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "1000" } });
  try {
    const a = await member(f, "rapide@exemple.fr");
    await a.command("quick");
    await a.wait((c) => c.state.table?.game);
    const t = f.app.db.tables[a.state.table.id];
    assert.equal(t.stake, 200);
    assert.equal(t.money.seats.filter((x) => x.house).length, 3);
    const p = f.app.db.players[a.state.player.id];
    assert.equal(p.wallet.reserved, Math.min(p.wallet.balance, 400));
    // Un invité sans compte joue la partie rapide gratuitement.
    const g = await f.client();
    await g.command("quick");
    await g.wait((c) => c.state.table?.game);
    assert.equal(f.app.db.tables[g.state.table.id].stake, 0);
  } finally {
    await f.close();
  }
});

test("Jouer maintenant : revanche relancée, robots de la Maison et absents remplacés", async () => {
  // Donnes suivantes automatiques (résultat affiché 5 ms) : la partie en 1 500 points s'enchaîne sans commandes.
  const f = await fixture({ fillSeconds: 0.05, botDelay: 1, summaryMs: 5, QUICK_REMATCH_WAIT: 200, env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "5000" } });
  try {
    const a = await member(f, "rev-a@exemple.fr"),
      b = await member(f, "rev-b@exemple.fr");
    await a.command("quick");
    await b.command("quick");
    await a.wait((c) => c.state.table?.game);
    const t = f.app.db.tables[a.state.table.id];
    assert.equal(t.stake, 200);
    const human = { [a.state.player.id]: a, [b.state.player.id]: b };
    for (let guard = 0; t.game.phase !== "finished" && guard < 20000; guard++) {
      const g = t.game;
      const seat = t.seats[g.turn];
      if (g.phase === "summary" || g.phase === "counter" || seat.bot) await delay(2);
      else {
        const v = view(g, g.turn);
        const action = g.phase === "bidding" ? { type: "pass" } : { type: "play", card: v.legal[0] };
        await human[seat.id].send("action", { version: g.version, action });
        await delay(2);
      }
    }
    assert.equal(t.game.phase, "finished");
    const pa = f.app.db.players[a.state.player.id];
    // Partie 1 réglée : gain ou perte appliqué, plus rien de réservé.
    assert.equal(t.money.settled, true);
    assert.notEqual(pa.wallet.balance, 10000);
    assert.equal(pa.wallet.reserved, 0);
    // Même si la mise avait été suspendue, la revanche repart avec la mise d'origine.
    t.stake = 0;
    // A accepte ; B ne répond pas : après le délai, un robot prend sa place et la revanche démarre.
    await a.command("rematchVote", { accept: true });
    await a.wait(() => t.game.phase !== "finished");
    assert.equal(t.seats.filter((s) => s.bot).length, 3);
    assert.equal(f.app.db.players[b.state.player.id].tableId, null);
    assert.equal(t.stake, 200);
    assert.ok(t.money && !t.money.settled, "mise de la revanche engagée");
    assert.ok(pa.wallet.reserved > 0);
  } finally {
    await f.close();
  }
});

test("tables publiques : places libres complétées par des robots variés, mise tenue par la Maison", async () => {
  const f = await fixture({ fillSeconds: 0.05, env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "5000" } });
  try {
    const a = await member(f, "seul@exemple.fr");
    await a.command("playLobby", { stake: 200 });
    await a.wait((c) => c.state.table?.game);
    const t = f.app.db.tables[a.state.table.id];
    const bots = t.seats.filter((s) => s.bot);
    assert.equal(bots.length, 3);
    assert.equal(new Set(t.seats.map((s) => s.name)).size, 4, "prénoms tous différents");
    assert.equal(new Set(t.seats.map((s) => s.avatar)).size, 4, "avatars tous différents");
    assert.equal(t.stake, 200);
    assert.ok(t.money && t.money.seats.filter((x) => x.house).length === 3, "robots adossés à la Maison");
    // Les robots restent signalés comme tels à tous les joueurs.
    assert.ok(a.state.table.seats.filter((s) => s.bot).length === 3);
    // Table gratuite (invité) : même chose, sans mise.
    const g = await f.client();
    await g.command("playLobby", { stake: 0 });
    await g.wait((c) => c.state.table?.game);
    assert.equal(g.state.table.seats.filter((s) => s.bot).length, 3);
    assert.equal(f.app.db.tables[g.state.table.id].stake, 0);
  } finally {
    await f.close();
  }
});

test("joueurs réels d'abord : regroupés entre tables rapides et publiques avant les robots", async () => {
  const f = await fixture({ fillSeconds: 0.4, env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "5000" } });
  try {
    // A attend à la table à 200 ; B touche « Jouer maintenant » (200 jetons) : il rejoint A.
    const a = await member(f, "attente-a@exemple.fr"),
      b = await member(f, "attente-b@exemple.fr");
    await a.command("playLobby", { stake: 200 });
    await b.command("quick");
    assert.equal(b.state.table.id, a.state.table.id);
    await a.wait((c) => c.state.table?.game);
    assert.equal(a.state.table.seats.filter((s) => !s.bot).length, 2);
    assert.equal(a.state.table.seats.filter((s) => s.bot).length, 2);
    // Invités (gratuit) : C en partie rapide, D à la table gratuite. Avant les robots, ils sont réunis.
    const c = await f.client(),
      d = await f.client();
    await c.command("quick");
    await d.command("playLobby", { stake: 0 });
    await c.wait((x) => x.state.table?.game);
    await d.wait((x) => x.state.table?.game);
    assert.equal(c.state.table.id, d.state.table.id, "réunis à la même table");
    assert.equal(c.state.table.seats.filter((s) => !s.bot).length, 2);
  } finally {
    await f.close();
  }
});

test("tables des villes et classement des joueurs", async () => {
  const f = await fixture({ env: { BELOTE_LOBBY_STAKES: "500,1000,2500,10000", BELOTE_LOGIN_BONUS: "0" } });
  try {
    const a = await member(f, "classe@exemple.fr");
    const lobby = a.state.tables.filter((t) => t.lobby).map((t) => [t.stake, t.name, t.city]).sort((x, y) => x[0] - y[0]);
    assert.deepEqual(lobby, [[500, "Paris", "paris"], [1000, "Monaco", "monaco"], [2500, "Dubaï", "dubai"], [10000, "Las Vegas", "vegas"]]);
    // Classement : seuls les comptes ayant joué, avec leur ratio.
    f.app.db.players[a.state.player.id].stats = { games: 12, wins: 9 };
    // Vainqueur d'un tournoi : une coupe.
    f.app.db.tournaments ??= {};
    f.app.db.tournaments.tx = { id: "tx", status: "finished", champion: "e1", teamsList: [{ id: "e1", pids: [a.state.player.id, "autre"] }] };
    const r = await (await fetch(f.base + "/api/classement", { headers: { Cookie: a.cookie } })).json();
    const me = r.players.find((x) => x.me);
    assert.deepEqual([me.games, me.wins, me.ratio, me.cups], [12, 9, 75, 1]);
    assert.ok(r.players.every((x) => x.games > 0));
  } finally {
    await f.close();
  }
});

test("appel des joueurs en ligne : invitation, refus, acceptation, robots à la demande", async () => {
  const f = await fixture({ matchWaitMs: 30_000, fillSeconds: 0.05 });
  try {
    const [a, b, c] = await Promise.all([f.client(), f.client(), f.client()]);
    await a.command("profile", { name: "Alice" });
    await a.command("quick");
    const table = a.state.table.id;
    // Les deux autres joueurs en ligne reçoivent l'appel avec le nom de ceux qui attendent.
    await b.wait((x) => x.queue.some((m) => m.type === "tableCall" && m.tableId === table));
    await c.wait((x) => x.queue.some((m) => m.type === "tableCall" && m.tableId === table));
    const call = b.queue.find((m) => m.type === "tableCall");
    assert.deepEqual([call.players, call.stake], [["Alice"], 0]);
    // On attend les joueurs appelés : pas de robot tout de suite.
    await delay(200);
    assert.equal(f.app.db.tables[table].seats.filter(Boolean).length, 1);
    await b.command("callAnswer", { tableId: table, accept: false });
    await c.command("callAnswer", { tableId: table, accept: true });
    assert.equal(f.app.db.tables[table].seats.filter(Boolean).length, 2);
    await a.wait((x) => x.state.table?.calls?.declined === 1);
    // Personne d'autre : Alice demande les robots, la partie démarre.
    await a.command("fillNow");
    await a.wait((x) => x.state.table?.game);
    assert.equal(f.app.db.tables[table].seats.filter((s) => s.bot).length, 2);
  } finally {
    await f.close();
  }
});

test("table des villes après une partie terminée : les joueurs en ligne sont quand même appelés", async () => {
  const f = await fixture({ matchWaitMs: 30_000, fillSeconds: 0.05 });
  try {
    const [a, b] = await Promise.all([f.client(), f.client()]);
    const lobby = Object.values(f.app.db.tables).find((x) => x.lobby && !x.stake);
    lobby.game = { ...newGame(), phase: "finished", scores: [1000, 500] }; // partie précédente gardée en mémoire
    await a.command("join", { tableId: lobby.id });
    await b.wait((x) => x.queue.some((m) => m.type === "tableCall" && m.tableId === lobby.id));
    await delay(150);
    assert.ok(!lobby.seats.some((s) => s?.bot), "pas de robot pendant l'appel");
    await a.command("fillNow");
    await a.wait((x) => x.state.table?.game && x.state.table.game.phase !== "finished");
  } finally {
    await f.close();
  }
});

test("parrainage : lien, code enregistré, 1 000 jetons chacun à la première partie, une seule fois", async () => {
  const f = await fixture({ env: { BELOTE_LOGIN_BONUS: "0", BELOTE_SIGNUP_BONUS: "100" } });
  try {
    const parrain = await member(f, "parrain@exemple.fr");
    const { code } = await parrain.command("refInfo");
    assert.match(code, /^[A-Z0-9x]{6}$/i);
    const filleul = await member(f, "filleul@exemple.fr");
    await filleul.command("referral", { code: "INCONNU" }, "error");
    const ok = await filleul.command("referral", { code });
    assert.ok(ok.referrer);
    await filleul.command("referral", { code }, "error"); // pas deux fois
    await parrain.command("referral", { code }, "error"); // pas soi-même
    const db = f.app.db,
      P = db.players[parrain.state.player.id],
      F = db.players[filleul.state.player.id];
    const before = [P.wallet.balance, F.wallet.balance];
    f.app.payReferral(F); // fin de la première partie
    f.app.payReferral(F); // une seule fois
    assert.deepEqual([P.wallet.balance - before[0], F.wallet.balance - before[1]], [2000, 2000]); // 1 000 jetons (demi-crédits)
    assert.equal((await parrain.command("refInfo")).count, 1);
  } finally {
    await f.close();
  }
});

test("visiteurs sans compte absents depuis 24 h : retirés, les autres sont gardés", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "belote-guests-"));
  const app = createApp({ dataDir: dir, tickMs: 100000 });
  try {
    const old = Date.now() - 2 * 86400_000;
    const base = { stats: { games: 0, wins: 0 }, history: [], tableId: null, seen: [], friends: {}, friendIn: [], friendOut: [], invites: [] };
    app.db.players.vieux = { ...base, id: "vieux", name: "Joueur aaaa", created: old, lastSeen: old };
    app.db.players.recent = { ...base, id: "recent", name: "Joueur bbbb", created: old, lastSeen: Date.now() - 3600_000 };
    app.db.players.joueur = { ...base, id: "joueur", name: "Joueur cccc", created: old, lastSeen: old, stats: { games: 2, wins: 1 } };
    app.db.players.compte = { ...base, id: "compte", name: "Sophie", accountId: "acc1", created: old, lastSeen: old };
    app.db.players.jetons = { ...base, id: "jetons", name: "Joueur dddd", created: old, lastSeen: old, wallet: { balance: 100, reserved: 0 } };
    assert.equal(app.sweepGuests(), 1);
    assert.deepEqual(Object.keys(app.db.players).filter((k) => ["vieux", "recent", "joueur", "compte", "jetons"].includes(k)).sort(), ["compte", "jetons", "joueur", "recent"]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sauvegarde : téléchargement par l'administrateur et copie vers le stockage externe", async () => {
  const http = await import("node:http");
  const received = [];
  const storage = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.end("ok");
    });
  });
  await new Promise((r) => storage.listen(0, "127.0.0.1", r));
  const env = {
    BELOTE_BACKUP_S3_ENDPOINT: `http://127.0.0.1:${storage.address().port}`,
    BELOTE_BACKUP_S3_BUCKET: "sauvegardes",
    BELOTE_BACKUP_S3_ACCESS_KEY_ID: "id",
    BELOTE_BACKUP_S3_SECRET_ACCESS_KEY: "secret",
  };
  const f = await fixture({ adminKey: "test-admin-key", env });
  try {
    const auth = { Authorization: "Bearer test-admin-key" };
    assert.equal((await fetch(f.base + "/api/admin?download=1")).status, 403);
    const dl = await fetch(f.base + "/api/admin?download=1", { headers: auth });
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get("content-disposition"), /belote-sauvegarde-/);
    assert.ok((await dl.json()).players);
    for (let i = 0; i < 200 && !received.length; i++) await delay(10); // copie automatique au démarrage (après 3 h UTC)
    if (new Date().getUTCHours() < 3) {
      const r = await fetch(f.base + "/api/admin", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ type: "backupNow" }) });
      assert.equal(r.status, 200);
      for (let i = 0; i < 200 && !received.length; i++) await delay(10);
    }
    assert.equal(received[0].method, "PUT");
    assert.match(received[0].url, /^\/sauvegardes\/belote\/sauvegarde-\d{4}-\d\d-\d\d\.json$/);
    assert.match(received[0].auth, /^AWS4-HMAC-SHA256 Credential=id\//);
    assert.ok(JSON.parse(received[0].body).players);
    const d = await (await fetch(f.base + "/api/admin", { headers: auth })).json();
    assert.equal(d.backup.configured, true);
    for (let i = 0; i < 100 && !d.backup.last; i++) await delay(10);
  } finally {
    await f.close?.();
    storage.close();
  }
});

test("conformité : chat filtré, plafond de dépenses, historique des achats", async () => {
  const f = await fixture();
  try {
    const a = await member(f, `conf${Date.now()}@exemple.fr`);
    await a.command("settings", { spendCap: 20 });
    await a.wait((c) => c.state.player.settings.spendCap === 20);
    await a.command("settings", { spendCap: 33 }); // valeur refusée : inchangé
    await delay(50);
    assert.equal(a.state.player.settings.spendCap, 20);
    assert.deepEqual(a.state.player.purchases, []);
    await a.command("create", { name: "Salon privé", vip: true });
    await a.wait((c) => c.state.table);
    await a.command("chat", { text: "Bien joué connard, belle contrée" });
    await a.wait((c) => c.state.table.chat?.length);
    assert.equal(a.state.table.chat.at(-1).text, "Bien joué c******, belle contrée");
  } finally {
    await f.close();
  }
});
