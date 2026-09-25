/**
 * Backfill tag status after the sold / deleted / deleted_p rules.
 * SQLite desktop also runs the same function at API boot.
 */
export async function up({ context: queryInterface }) {
  const { backfillSaleOutcomeStatuses } = await import('../services/productSaleStatusBackfill.js');
  await backfillSaleOutcomeStatuses(queryInterface.sequelize);
}

export async function down() {
  // Status labels are informational; do not revert live shop tags.
}
