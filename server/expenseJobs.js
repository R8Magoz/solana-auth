'use strict';

/**
 * Recurring expense maintenance — projection-only model (no auto-spawn).
 * Calendar visibility comes from client-side projection; rows are created only when users act.
 * Series metadata backfill runs via runRecurrenceSeriesMigration in migrate.js.
 */
function runExpenseMaintenance(audit) {
  void audit;
}

module.exports = { runExpenseMaintenance };
