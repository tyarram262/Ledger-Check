import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// node:sqlite (built-in, Node 22.5+) instead of better-sqlite3: same synchronous
// API shape, no native compile step. Requires Node >= 22.5.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  type  TEXT NOT NULL CHECK (type IN ('taxable','roth','traditional_ira'))
);

CREATE TABLE IF NOT EXISTS lots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  ticker         TEXT NOT NULL,
  shares         REAL NOT NULL CHECK (shares > 0),
  cost_per_share REAL NOT NULL CHECK (cost_per_share >= 0),
  purchase_date  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id           INTEGER NOT NULL REFERENCES accounts(id),
  ticker               TEXT NOT NULL,
  shares               REAL NOT NULL CHECK (shares > 0),
  sale_price_per_share REAL NOT NULL CHECK (sale_price_per_share >= 0),
  cost_per_share       REAL NOT NULL CHECK (cost_per_share >= 0),
  sale_date            TEXT NOT NULL,
  realized_gain_loss   REAL NOT NULL,
  source               TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','recorded'))
);

CREATE TABLE IF NOT EXISTS quotes (
  ticker     TEXT PRIMARY KEY,
  price      REAL NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digest_cache (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  content        TEXT NOT NULL,
  portfolio_hash TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
`;

// Survive Next.js dev-server module reloads with a single connection.
const globalForDb = globalThis as unknown as { __ledgerDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__ledgerDb) return globalForDb.__ledgerDb;

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "ledger.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const row = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
    n: number;
  };
  if (row.n === 0) {
    db.prepare("INSERT INTO accounts (name, type) VALUES (?, ?)").run(
      "Taxable Brokerage",
      "taxable"
    );
  }

  globalForDb.__ledgerDb = db;
  return db;
}
