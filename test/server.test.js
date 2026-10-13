import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server.js";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "belote-test-"));
  const app = createApp({ dataDir: dir, tickMs: 10, botDelay: 1, ...opts });
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
    await players[0].command("start");
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
    assert.match(await index.text(), /Maison Belote/);
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
    await players[0].command("start");
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
    await players[0].command("start");
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
    const card = players[0].state.table.game.legal[0];
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
    await c.command("profile", { name: "Sophie", avatar: "hibou" });
    await c.wait((c) => c.state.player.avatar === "hibou");
    await c.command("profile", { avatar: "♠" }, "error");
    await c.command("profile", { name: "x" }, "error");
    const jpeg = new Uint8Array(200).fill(1);
    jpeg.set([0xff, 0xd8, 0xff]);
    assert.equal((await api(f, c.cookie, "/api/avatar", new Uint8Array([1, 2, 3]))).status, 400);
    const r = await api(f, c.cookie, "/api/avatar", jpeg);
    assert.match(r.body.avatar, /^u:[0-9a-f]{32}$/);
    const img = await fetch(`${f.base}/u/${r.body.avatar.slice(2)}.jpg`);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    assert.equal((await fetch(f.base + "/avatars/renard.svg")).status, 200);
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
    await players[0].command("start");
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
