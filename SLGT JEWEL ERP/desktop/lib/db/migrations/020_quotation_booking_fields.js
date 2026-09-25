'use strict';
/**
 * Migration 020 — estimation booking fields (advance + price lock).
 */
module.exports = {
  id: 20,
  name: 'quotation_booking_fields',
  up(db) {
    const cols = db.pragma('table_info(quotations)').map((c) => c.name);
    if (!cols.includes('price_locked')) {
      db.exec('ALTER TABLE quotations ADD COLUMN price_locked INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.includes('advance_paid')) {
      db.exec('ALTER TABLE quotations ADD COLUMN advance_paid REAL NOT NULL DEFAULT 0');
    }
    if (!cols.includes('advance_id')) {
      db.exec('ALTER TABLE quotations ADD COLUMN advance_id TEXT');
    }
    if (!cols.includes('booked_at')) {
      db.exec('ALTER TABLE quotations ADD COLUMN booked_at TEXT');
    }
  },
};
