const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');

function openDatabase(databasePath = config.databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      source_account TEXT NOT NULL,
      destination_account TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'PROCESSED')),
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transaction_jobs (
      transaction_id TEXT PRIMARY KEY REFERENCES transactions(transaction_id),
      available_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_jobs_available
      ON transaction_jobs(available_at, claimed_at);
  `);
  return db;
}

module.exports = { openDatabase };
