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
    ownerId       TEXT REFERENCES users(id),
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
    ownerId       TEXT REFERENCES users(id),
    paidByJson    TEXT,
    splitMode     TEXT,
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

  CREATE TABLE IF NOT EXISTS departments (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    budget    REAL NOT NULL DEFAULT 0,
    archived  INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
`);

function addColumnIfMissing(table, column, colDef) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`);
}

addColumnIfMissing('expenses', 'departmentId', 'TEXT');
addColumnIfMissing('expenses', 'approversJson', 'TEXT');
addColumnIfMissing('expenses', 'approvalVotesJson', 'TEXT');
addColumnIfMissing('expenses', 'paidByJson', 'TEXT');
addColumnIfMissing('expenses', 'splitMode', 'TEXT');
addColumnIfMissing('expenses', 'ivaRate', 'REAL');
addColumnIfMissing('expenses', 'ivaAmount', 'REAL');
addColumnIfMissing('expenses', 'commentsJson', 'TEXT');
addColumnIfMissing('expenses', 'ownerId', 'TEXT');
addColumnIfMissing('bills', 'departmentId', 'TEXT');
addColumnIfMissing('bills', 'receiptPath', 'TEXT');
addColumnIfMissing('bills', 'ownerId', 'TEXT');
addColumnIfMissing('bills', 'paidByJson', 'TEXT');
addColumnIfMissing('bills', 'splitMode', 'TEXT');
addColumnIfMissing('users', 'avatar', 'TEXT');
addColumnIfMissing('departments', 'archived', 'INTEGER NOT NULL DEFAULT 0');

const _deptCount = db.prepare('SELECT COUNT(*) AS c FROM departments').get();
if (_deptCount.c === 0) {
  const now = Date.now();
  const ins = db.prepare(
    'INSERT INTO departments (id, name, budget, createdAt) VALUES (?, ?, ?, ?)',
  );
  ins.run('dept_branding', 'Branding', 10000, now);
  ins.run('dept_estrategia', 'Estrategia', 5000, now);
  ins.run('dept_operaciones', 'Operaciones', 3000, now);
}

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
