'use strict';

/**
 * @deprecated Legacy bills-table recurrence spawner — unused since facturas live in `expenses`.
 * Not scheduled from server.js. Recurrence materialization runs via expenseJobs.runExpenseMaintenance.
 */
function runBillMaintenance(audit) {
  void audit;
}

module.exports = { runBillMaintenance };
