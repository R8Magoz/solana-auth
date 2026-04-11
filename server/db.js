'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'solana.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,
    email              TEXT UNIQUE NOT NULL,
    name               TEXT,
    title              TEXT DEFAULT '',
    phone              TEXT DEFAULT '',
    passwordHash       TEXT NOT NULL,
    role               TEXT DEFAULT 'user',
    color              TEXT DEFAULT '#6B7280',
    accountStatus      TEXT DEFAULT 'pending_admin_approval',
    approvalStatus     TEXT DEFAULT 'pending',
    emailVerifiedAt    INTEGER,
    approvedBy         TEXT,
    approvedAt         INTEGER,
    deniedAt           INTEGER,
    deniedBy           TEXT,
    deniedReason       TEXT,
    createdAt          INTEGER NOT NULL,
    seedTag            TEXT,
    mustChangePassword INTEGER DEFAULT 0,
    tempPasswordExp    INTEGER
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id            TEXT PRIMARY KEY,
    userId        TEXT NOT NULL REFERENCES users(id),
    amount        REAL NOT NULL,
    currency      TEXT DEFAULT 'EUR',
    amountEUR     REAL,
    description   TEXT NOT NULL,
    category      TEXT NOT NULL,
    date          TEXT NOT NULL,
    status        TEXT DEFAULT 'submitted',
    approvedBy    TEXT REFERENCES users(id),
    approvedAt    INTEGER,
    rejectedBy    TEXT REFERENCES users(id),
    rejectedAt    INTEGER,
    rejectionNote TEXT,
    receiptPath   TEXT,
    notes         TEXT,
    createdAt     INTEGER NOT NULL,
    updatedAt     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bills (
    id            TEXT PRIMARY KEY,
    userId        TEXT NOT NULL REFERENCES users(id),
    vendor        TEXT NOT NULL,
    amount        REAL NOT NULL,
    currency      TEXT DEFAULT 'EUR',
    amountEUR     REAL,
    category      TEXT NOT NULL,
    dueDate       TEXT NOT NULL,
    status        TEXT DEFAULT 'pending',
    recurring     INTEGER DEFAULT 0,
    recurrenceRule TEXT,
    paidAt        INTEGER,
    paidBy        TEXT REFERENCES users(id),
    notes         TEXT,
    createdAt     INTEGER NOT NULL,
    updatedAt     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    event     TEXT NOT NULL,
    userId    TEXT,
    targetId  TEXT,
    detail    TEXT,
    ip        TEXT
  );
`);

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
