/**
 * Historically inserted a built-in "Tray" unit into catalog_items.
 * Catalog defaults are now opt-in (CRM_SEED_CATALOG=1) so factory reset /
 * empty DBs stay empty. Shops that already ran this migration keep their Tray row.
 */
export async function up() {
  return;
}

export async function down() {
  return;
}
