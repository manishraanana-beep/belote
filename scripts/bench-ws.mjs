// Mesure du trafic WebSocket d'une partie d'entraînement (contre 3 robots), octets réellement
// échangés sur le réseau (compressés si permessage-deflate est actif).
// Usage : node scripts/bench-ws.mjs [--deflate=0] [--target=250] [--extra-tables=60]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createApp } from "../src/server.js";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const deflate = arg("deflate", "1");
const delta = arg("delta", "1"); // 1 : messages partiels table/player/lobby ; 0 : ancien état complet
const target = Number(arg("target", 250));
const extra = Number(arg("extra-tables", 60));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(path.join(tmpdir(), "belote-bench-"));
const app = createApp({ dataDir: dir, tickMs: 50, botDelay: 30, matchWaitMs: 0, env: { ...process.env, BELOTE_WS_DEFLATE: deflate, BELOTE_TABLE_FEE_PCT: "0" } });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;

async function client() {
  const r = await fetch(base + "/api/session", { method: "POST" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const c = { state: null, sizes: [], acks: [], pending: new Map() };
  c.ws = new WebSocket(base.replace("http", "ws") + (delta === "1" ? "/ws?delta=1" : "/ws"), { headers: { Cookie: cookie, Origin: base } });
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    c.sizes.push(raw.length);
    if (m.type === "state") c.state = m;
    else if (c.state && m.type === "table") Object.assign(c.state, { table: m.table, online: m.online });
    else if (c.state && m.type === "player") c.state.player = m.player;
    else if (c.state && m.type === "lobby") Object.assign(c.state, { ...m, type: "state" });
    if (m.id && c.pending.has(m.id)) {
      c.acks.push(performance.now() - c.pending.get(m.id));
      c.pending.delete(m.id);
    }
  });
  c.send = (type, data = {}) => {
    const id = randomUUID();
    c.pending.set(id, performance.now());
    c.ws.send(JSON.stringify({ id, type, data }));
  };
  while (!c.state) await delay(10);
  return c;
}

// Autres joueurs en ligne : chacun crée une table publique (alourdit `tables`, comme en production).
const others = [];
for (let i = 0; i < extra; i++) {
  const o = await client();
  o.send("create", { name: `Table publique ${i}`, vip: false, rules: { target: 1000 } });
  others.push(o);
}
await delay(300);
const p = await client();
others.length && (await delay(300));
const lobbyTables = p.state.tables.length;
const wsSock = () => p.ws._socket;
const wire0 = wsSock().bytesRead;
const n0 = p.sizes.length;
p.sizes.length = 0;
p.acks.length = 0;
const cpu0 = (process.cpuUsage().user + process.cpuUsage().system) / 1000;
const t0 = performance.now();
p.send("practice", { rules: { target } });
let guard = 0;
while (guard++ < 4000) {
  const g = p.state?.table?.game;
  if (g?.phase === "finished") break;
  if (g?.phase === "summary") p.send("next");
  else if (g?.turn === 0 && g.phase === "bidding") p.send("action", { version: g.version, action: g.contract ? { type: "pass" } : { type: "bid", amount: 80, suit: "S" } });
  else if (g?.turn === 0 && g.phase === "playing") p.send("action", { version: g.version, action: { type: "play", card: g.legal[0] } });
  await delay(40);
}
const secs = (performance.now() - t0) / 1000;
const wire = wsSock().bytesRead - wire0;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
console.log(
  JSON.stringify(
    {
      deflate: deflate !== "0",
      delta: delta === "1",
      cpuServeurEtClientsMs: Math.round((process.cpuUsage().user + process.cpuUsage().system) / 1000 - cpu0),
      tablesDansLobby: lobbyTables,
      dureeS: +secs.toFixed(1),
      messages: p.sizes.length,
      messagesParMin: Math.round((p.sizes.length / secs) * 60),
      tailleMoyKo: +(sum(p.sizes) / p.sizes.length / 1024).toFixed(1),
      tailleMaxKo: +(Math.max(...p.sizes) / 1024).toFixed(1),
      totalDecompresseKo: Math.round(sum(p.sizes) / 1024),
      totalReseauKo: Math.round(wire / 1024),
      reseauParMessageKo: +(wire / p.sizes.length / 1024).toFixed(1),
      ackMedianMs: +med(p.acks).toFixed(1),
    },
    null,
    1,
  ),
);
for (const c of [p, ...others]) c.ws.terminate();
await app.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
