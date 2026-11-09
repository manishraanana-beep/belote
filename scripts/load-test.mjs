// Test de charge LOCAL : N joueurs connectés jouent en même temps des parties d'entraînement (contre 3 robots).
// Un serveur de test est lancé dans ce processus avec une base temporaire : rien n'est envoyé au site en ligne.
// Usage : node scripts/load-test.mjs [--steps=10,25,50,100] [--secs=30] [--play-ms=300]
//   --steps    nombres de joueurs simultanés, testés l'un après l'autre
//   --secs     durée de chaque palier
//   --play-ms  délai entre deux actions d'un joueur (un humain joue en 1 à 5 s : 300 est sévère)
// Lecture : « retardBoucleP99Ms » (retard de la boucle d'événements du serveur) et « ackP95Ms » (temps de réponse
// aux actions). Si l'un dépasse ~100 ms, le palier est lourd ; au-delà de ~500 ms, les joueurs sentent des à-coups.
// Les clients tournent dans le même processus que le serveur : les chiffres sont un peu pessimistes.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { WebSocket } from "ws";
import { createApp } from "../src/server.js";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const steps = arg("steps", "10,25,50,100").split(",").map(Number);
const secs = Number(arg("secs", 30));
const playMs = Number(arg("play-ms", 300));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

const dir = mkdtempSync(path.join(tmpdir(), "belote-load-"));
const app = createApp({ dataDir: dir, env: { ...process.env, BELOTE_TABLE_FEE_PCT: "0" } });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;

async function client(acks) {
  const r = await fetch(base + "/api/session", { method: "POST" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const c = { state: null, pending: new Map(), msgs: 0, closed: false };
  c.ws = new WebSocket(base.replace("http", "ws") + "/ws?delta=1", { headers: { Cookie: cookie, Origin: base } });
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    c.msgs++;
    if (m.type === "state") c.state = m;
    else if (c.state && m.type === "table") Object.assign(c.state, { table: m.table, online: m.online });
    else if (c.state && m.type === "player") c.state.player = m.player;
    else if (c.state && m.type === "lobby") Object.assign(c.state, { ...m, type: "state" });
    if (m.id && c.pending.has(m.id)) {
      acks.push(performance.now() - c.pending.get(m.id));
      c.pending.delete(m.id);
    }
  });
  c.ws.on("close", () => (c.closed = true));
  c.send = (type, data = {}) => {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    const id = randomUUID();
    c.pending.set(id, performance.now());
    c.ws.send(JSON.stringify({ id, type, data }));
  };
  for (let i = 0; i < 500 && !c.state; i++) await delay(10);
  return c;
}

// Un joueur joue en boucle (nouvelle partie dès que l'autre est finie) jusqu'à l'arrêt.
async function player(c, stop) {
  c.send("practice", { rules: { target: 250 } });
  while (!stop.done && !c.closed) {
    const g = c.state?.table?.game;
    if (!c.state?.table || g?.phase === "finished") c.send("practice", { rules: { target: 250 } });
    else if (g?.phase === "summary") c.send("next");
    else if (g?.turn === 0 && g.phase === "bidding") c.send("action", { version: g.version, action: g.contract ? { type: "pass" } : { type: "bid", amount: 80, suit: "S" } });
    else if (g?.turn === 0 && g.phase === "playing") c.send("action", { version: g.version, action: { type: "play", card: g.legal[0] } });
    await delay(playMs);
  }
}

const results = [];
for (const n of steps) {
  const acks = [];
  const clients = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const c = await client(acks).catch(() => null);
    if (c?.state) clients.push(c);
  }
  const connectS = (performance.now() - t0) / 1000;
  acks.length = 0;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const cpu0 = process.cpuUsage();
  const mem0 = process.memoryUsage().rss;
  const stop = { done: false };
  const runs = clients.map((c) => player(c, stop));
  const tStart = performance.now();
  await delay(secs * 1000);
  const dur = (performance.now() - tStart) / 1000;
  stop.done = true;
  lag.disable();
  const cpu = process.cpuUsage(cpu0);
  const msgs = clients.reduce((s, c) => s + c.msgs, 0);
  const row = {
    joueursDemandes: n,
    joueursConnectes: clients.length,
    connexionS: +connectS.toFixed(1),
    cpuPct: +((((cpu.user + cpu.system) / 1000 / 1000) / dur) * 100).toFixed(0),
    retardBoucleP99Ms: +(lag.percentile(99) / 1e6).toFixed(1),
    retardBoucleMaxMs: +(lag.max / 1e6).toFixed(1),
    ackMedianMs: +pct(acks, 0.5).toFixed(1),
    ackP95Ms: +pct(acks, 0.95).toFixed(1),
    actionsSansReponse: clients.reduce((s, c) => s + c.pending.size, 0),
    memoireMo: Math.round(process.memoryUsage().rss / 1048576),
    croissanceMemoireMo: Math.round((process.memoryUsage().rss - mem0) / 1048576),
    messagesParSeconde: Math.round(msgs / (dur + connectS)),
  };
  results.push(row);
  console.log(JSON.stringify(row));
  for (const c of clients) c.ws.terminate();
  await Promise.allSettled(runs);
  await delay(1500);
}
console.table(results);
await app.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
