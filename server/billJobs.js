'use strict';

/**
 * @deprecated Legacy bills-table recurrence spawner — unused since facturas live in `expenses`.
 * Not scheduled from server.js. Recurrence is projection-only on unified expenses (see recurrence.js).
 */
function runBillMaintenance(audit) {
  void audit;
}

module.exports = { runBillMaintenance };
