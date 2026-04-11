/**
 * SOLANA AUTH SERVER — Seed / Bootstrap Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates or resets dev/staging test accounts in SQLite (solana.db).
 * NEVER run this in production.
 *
 * Usage:
 *   ALLOW_SEED=true node seed.js
 *   ALLOW_SEED=true SEED_RESET=true node seed.js   ← hard-reset test users only
 *
 * Required env vars:
 *   ALLOW_SEED=true          — must be explicitly set; absent in production .env
 *   SEED_ADMIN_EMAIL         — email for the bootstrap superadmin (your email)
 *   SEED_ADMIN_PASSWORD      — password for the bootstrap superadmin (min 8 chars)
 *
 * Optional env vars:
 *   SEED_RESET=true          — resets test users to seed state without touching real users
 *   SEED_USER_EMAIL          — email for the approved normal test user
 *   SEED_USER_PASSWORD       — password for the approved normal test user
 *   SEED_PENDING_EMAIL       — email for the pending-approval test user
 *   SEED_PENDING_PASSWORD    — password for the pending-approval test user
 *
 * Seeded accounts:
 *   bootstrap-admin   → accountStatus: active, role: superadmin (your account)
 *   approved-user     → accountStatus: active, role: user       (test normal flow)
 *   pending-user      → accountStatus: pending_admin_approval   (test approval UI)
 *
 * Safety:
 *   - Guards: ALLOW_SEED=true required, exits otherwise.
 *   - Idempotent: updates by email, never creates duplicates.
 *   - Writes audit entries for every operation.
 *   - Does NOT modify users who are not in the seed list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── SAFETY GATE — must be the very first check ───────────────────────────────
if (process.env.ALLOW_SEED !== 'true') {
  console.error(
    '[SEED] Refused: ALLOW_SEED is not set to "true".\n' +
    '       Set ALLOW_SEED=true in your .env only for dev/staging environments.\n' +
    '       NEVER set this in production.'
  );
  process.exit(1);
}

const bcrypt = require('bcrypt');
const fs     = require('fs');
const path   = require('path');

const BCRYPT_ROUNDS = 12;
const DATA_DIR      = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const auditLog = require('./auditLog');
auditLog.migrateLegacyFile(path.join(DATA_DIR, 'audit.log'));

function seedAudit(event, data = {}) {
  auditLog.write(event, { ...data, source: 'seed' });
  console.log('[SEED-AUDIT]', event, data);
}

const { runUsersJsonMigration } = require('./migrate');
runUsersJsonMigration({ dataDir: DATA_DIR, audit: seedAudit });

const userStore = require('./userStore');

// ── ENV ───────────────────────────────────────────────────────────────────────
const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    || 'r8magoz@gmail.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const USER_EMAIL     = process.env.SEED_USER_EMAIL     || `testuser+${Date.now()}@solana-dev.local`;
const USER_PASSWORD  = process.env.SEED_USER_PASSWORD  || 'SolanaTestUser99!';
const PEND_EMAIL     = process.env.SEED_PENDING_EMAIL  || `pending+${Date.now()}@solana-dev.local`;
const PEND_PASSWORD  = process.env.SEED_PENDING_PASSWORD || 'SolanaPending99!';

if (!ADMIN_PASSWORD) {
  console.error(
    '[SEED] Error: SEED_ADMIN_PASSWORD is required.\n' +
    '       Set it in your .env file. Minimum 8 characters.'
  );
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 8) {
  console.error('[SEED] Error: SEED_ADMIN_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

// ── SEED DEFINITIONS ─────────────────────────────────────────────────────────
const SEED_TAG = 'seeded';
const BOOTSTRAP_ID = 'bootstrap-admin';

async function buildSeedUsers() {
  const now = Date.now();
  return [
    {
      _seedRole: 'bootstrap_admin',
      id:            BOOTSTRAP_ID,
      email:         ADMIN_EMAIL,
      name:          'Bootstrap Admin',
      passwordHash:  await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS),
      role:          'superadmin',
      color:         '#3C0A37',
      accountStatus: 'active',
      approvalStatus:'approved',
      emailVerifiedAt: now,
      approvedBy:    'seed',
      approvedAt:    now,
      deniedAt:      null,
      deniedBy:      null,
      createdAt:     now,
      seedTag:       SEED_TAG,
    },
    {
      _seedRole: 'approved_user',
      id:            'seed-approved-user',
      email:         USER_EMAIL,
      name:          'Test User (Approved)',
      passwordHash:  await bcrypt.hash(USER_PASSWORD, BCRYPT_ROUNDS),
      role:          'user',
      color:         '#4A7C59',
      accountStatus: 'active',
      approvalStatus:'approved',
      emailVerifiedAt: now,
      approvedBy:    'seed',
      approvedAt:    now,
      deniedAt:      null,
      deniedBy:      null,
      createdAt:     now,
      seedTag:       SEED_TAG,
    },
    {
      _seedRole: 'pending_user',
      id:            'seed-pending-user',
      email:         PEND_EMAIL,
      name:          'Test User (Pending)',
      passwordHash:  await bcrypt.hash(PEND_PASSWORD, BCRYPT_ROUNDS),
      role:          'user',
      color:         '#7A5C74',
      accountStatus: 'pending_admin_approval',
      approvalStatus:'pending',
      emailVerifiedAt: now,
      approvedBy:    null,
      approvedAt:    null,
      deniedAt:      null,
      deniedBy:      null,
      createdAt:     now,
      seedTag:       SEED_TAG,
    },
  ];
}

// ── UPSERT LOGIC ──────────────────────────────────────────────────────────────
async function runSeed() {
  const isReset = process.env.SEED_RESET === 'true';
  const seedUsers = await buildSeedUsers();
  const existingCount = userStore.getAllUsers().length;

  console.log(`\n[SEED] Mode: ${isReset ? 'RESET (overwrite seed accounts)' : 'UPSERT (create or update)'}`);
  console.log(`[SEED] Bootstrap admin email: ${ADMIN_EMAIL}`);
  console.log(`[SEED] Approved test user:    ${USER_EMAIL}`);
  console.log(`[SEED] Pending test user:     ${PEND_EMAIL}`);
  console.log(`[SEED] Existing users in DB: ${existingCount}`);

  let created = 0, updated = 0;

  for (const seedUser of seedUsers) {
    const { _seedRole, ...userRecord } = seedUser;
    const existing = userStore.findUserByEmailOrId(userRecord.email, userRecord.id);

    if (!existing) {
      userStore.insertUser(userRecord);
      created++;
      seedAudit('seed_created', {
        userId: userRecord.id, email: userRecord.email,
        role: userRecord.role, accountStatus: userRecord.accountStatus,
        seedRole: _seedRole,
      });
      console.log(`  ✓ Created: ${userRecord.email} (${_seedRole})`);
    } else if (isReset || existing.seedTag === SEED_TAG) {
      const merged = {
        ...userRecord,
        id: existing.id,
        createdAt: existing.createdAt || userRecord.createdAt,
        passwordHash: userRecord.passwordHash,
      };
      userStore.replaceUserById(merged);
      updated++;
      seedAudit('seed_updated', {
        userId: userRecord.id, email: userRecord.email,
        role: userRecord.role, accountStatus: userRecord.accountStatus,
        seedRole: _seedRole, reset: isReset,
      });
      console.log(`  ↺ Updated: ${userRecord.email} (${_seedRole})`);
    } else {
      console.log(`  ⚠ Skipped: ${userRecord.email} — real user exists with this email (not a seed account)`);
      seedAudit('seed_skipped', {
        email: userRecord.email, reason: 'real_user_exists', seedRole: _seedRole,
      });
    }
  }

  console.log(`\n[SEED] Done. Created: ${created}, Updated: ${updated}`);
  console.log('[SEED] Accounts ready:');
  console.log(`  email=${ADMIN_EMAIL}      role=superadmin  status=active`);
  console.log(`  email=${USER_EMAIL}  role=user        status=active`);
  console.log(`  email=${PEND_EMAIL}  role=user        status=pending_admin_approval`);
}

// ── RESET-ONLY MODE ───────────────────────────────────────────────────────────
async function runReset() {
  const existingUsers = userStore.getAllUsers();
  const seedCount = existingUsers.filter(u => u.seedTag === SEED_TAG).length;
  const realUserCount = existingUsers.length - seedCount;

  console.log(`[SEED] Removing ${seedCount} seed-tagged accounts, keeping ${realUserCount} real users.`);
  seedAudit('seed_reset_start', { removedSeedCount: seedCount, realUserCount });

  userStore.deleteUsersWithSeedTag(SEED_TAG);
  await runSeed();
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
(async () => {
  try {
    if (process.env.SEED_RESET === 'true') {
      await runReset();
    } else {
      await runSeed();
    }
    process.exit(0);
  } catch (err) {
    console.error('[SEED] Fatal error:', err.message);
    process.exit(1);
  }
})();
