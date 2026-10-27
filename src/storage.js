// Stockage des données du jeu dans SQLite (inclus dans Node 22, aucune dépendance) :
// chaque enregistrement est une transaction « tout ou rien ».
//  - table « state »  : une ligne par collection (joueurs, tables, tournois…), en JSON ;
//  - table « ledger » : le journal des jetons, une ligne par mouvement, clé unique (jamais deux fois).
// Au premier démarrage, l'ancien fichier state.json est importé puis conservé (renommé, jamais supprimé).
// BELOTE_STORAGE=json garde l'ancien fonctionnement (retour arrière).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Les collections du journal vivent dans leur propre table.
const LEDGER_KEYS = new Set(["ledger", "ledgerKeys"]);

function totals(db) {
  const players = Object.values(db.players ?? {});
  return {
    players: players.length,
    accounts: Object.keys(db.accounts ?? {}).length,
    tournaments: Object.keys(db.tournaments ?? {}).length,
    ledger: (db.ledger ?? []).length,
    balance: players.reduce((n, p) => n + (p.wallet?.balance ?? 0), 0),
  };
}

export function openStorage({ dataDir, mode = "sqlite", now = () => Date.now() }) {
  const jsonFile = path.join(dataDir, "state.json");
  if (mode === "json") {
    return {
      kind: "json",
      load: () => (existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, "utf8")) : null),
      save(db) {
        writeFileSync(jsonFile + ".tmp", JSON.stringify(db), { mode: 0o600 });
        renameSync(jsonFile + ".tmp", jsonFile);
      },
      close() {},
    };
  }
  // Avertissement « expérimental » de node:sqlite : sans effet sur le fonctionnement, on le tait.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emit.call(process, w, ...rest));
  const { DatabaseSync } = require("node:sqlite");
  process.emitWarning = emit;
  const file = path.join(dataDir, "belote.db");
  const sql = new DatabaseSync(file);
  sql.exec(`PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, key TEXT NOT NULL UNIQUE, pid TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ledger_pid ON ledger (pid);`);
  const upsert = sql.prepare("INSERT INTO state (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json");
  const drop = sql.prepare("DELETE FROM state WHERE key = ?");
  const addEntry = sql.prepare("INSERT OR IGNORE INTO ledger (id, key, pid, json) VALUES (?, ?, ?, ?)");
  let closed = false;
  const last = new Map(); // dernier JSON enregistré par collection : on n'écrit que ce qui change
  let savedLedger = 0;

  function tx(fn) {
    sql.exec("BEGIN IMMEDIATE");
    try {
      fn();
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  }
  function save(db) {
    if (closed) return;
    // On prépare tout avant d'écrire ; la mémoire « déjà enregistré » n'est mise à jour qu'après
    // une transaction réussie (en cas d'échec, tout sera réécrit la fois suivante).
    const changed = [];
    for (const [k, v] of Object.entries(db)) {
      if (LEDGER_KEYS.has(k)) continue;
      const json = JSON.stringify(v);
      if (json !== undefined && last.get(k) !== json) changed.push([k, json]);
    }
    const removed = [...last.keys()].filter((k) => !(k in db));
    const ledger = db.ledger ?? [];
    const fresh = ledger.slice(savedLedger);
    if (!changed.length && !removed.length && !fresh.length) return;
    tx(() => {
      for (const [k, json] of changed) upsert.run(k, json);
      for (const k of removed) drop.run(k);
      for (const e of fresh) addEntry.run(e.id, e.key, e.pid ?? null, JSON.stringify(e));
    });
    for (const [k, json] of changed) last.set(k, json);
    for (const k of removed) last.delete(k);
    savedLedger = ledger.length;
  }
  function readAll() {
    const rows = sql.prepare("SELECT key, json FROM state").all();
    if (!rows.length) return null;
    const db = {};
    for (const r of rows) {
      db[r.key] = JSON.parse(r.json);
      last.set(r.key, r.json);
    }
    db.ledger = sql.prepare("SELECT json FROM ledger ORDER BY seq").all().map((r) => JSON.parse(r.json));
    db.ledgerKeys = Object.fromEntries(db.ledger.map((e) => [e.key, e.id]));
    savedLedger = db.ledger.length;
    return db;
  }
  function load() {
    const db = readAll();
    if (db) return db;
    if (!existsSync(jsonFile)) return null;
    // Migration unique : import de state.json, vérification, puis l'ancien fichier est conservé.
    const old = JSON.parse(readFileSync(jsonFile, "utf8"));
    const before = totals(old);
    save(old);
    last.clear();
    const after = totals(readAll());
    const ok = JSON.stringify(before) === JSON.stringify(after);
    if (!ok) throw Error(`Migration SQLite incomplète : ${JSON.stringify(before)} ≠ ${JSON.stringify(after)} (state.json conservé, rien n'a été supprimé)`);
    const kept = `${jsonFile}.migre-${new Date(now()).toISOString().replace(/[:.]/g, "-")}`;
    renameSync(jsonFile, kept);
    const migrated = readAll();
    migrated.migration = { at: now(), from: path.basename(kept), ...after, ok };
    console.log(`Données importées dans SQLite : ${after.players} joueurs, ${after.ledger} mouvements de jetons, total ${after.balance / 2} jetons. Ancien fichier conservé : ${path.basename(kept)}`);
    return migrated;
  }
  return { kind: "sqlite", file, load, save, close: () => closed || ((closed = true), sql.close()) };
}
