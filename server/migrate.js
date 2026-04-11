'use strict';

const fs = require('fs');
const path = require('path');
const { insertUsersFromJsonRows } = require('./userStore');

/**
 * One-time migration: flat users.json → SQLite when the users table is empty.
 * Renames users.json → users.json.migrated after success (never delete).
 */
function runUsersJsonMigration({ dataDir, audit }) {
  const usersJsonPath = path.join(dataDir, 'users.json');
  const migratedPath = path.join(dataDir, 'users.json.migrated');

  if (!fs.existsSync(usersJsonPath)) return;

  const db = require('./db');
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  let users;
  try {
    users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
  } catch (e) {
    console.error('[MIGRATE] Failed to read users.json:', e.message);
    return;
  }

  if (!Array.isArray(users)) {
    console.error('[MIGRATE] users.json is not an array; skipping.');
    return;
  }

  try {
    insertUsersFromJsonRows(users);
  } catch (e) {
    console.error('[MIGRATE] Insert failed; leaving users.json untouched:', e.message);
    return;
  }

  try {
    fs.renameSync(usersJsonPath, migratedPath);
  } catch (e) {
    console.error('[MIGRATE] Data migrated but rename failed:', e.message);
    audit('migration_rename_failed', { error: e.message });
    return;
  }

  audit('migration_users_json_to_sqlite', {
    count: users.length,
    backup: 'users.json.migrated',
  });
  console.log(`[MIGRATE] Imported ${users.length} user(s) from users.json → SQLite; backup: users.json.migrated`);
}

module.exports = { runUsersJsonMigration };
