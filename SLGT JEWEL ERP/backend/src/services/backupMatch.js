/**
 * Shared natural-key matcher for the Settings → Backup & Export restore paths.
 *
 * Used by inventoryBackupService and customerBackupService so both behave the
 * same way (and so this — the easiest part of a restore to get subtly wrong —
 * exists in exactly one place).
 */

/**
 * Match one source row to an existing target row, never handing the same
 * target row to two different source rows.
 *
 * Exact (case-sensitive) key first, so rows that legitimately differ only by
 * case — e.g. categories "NOSEPINS" and "nosepins" — stay two rows on restore.
 * Falls back to a case-insensitive key so a source "gold" still finds a seeded
 * "Gold" master instead of duplicating it.
 *
 * Rows created during this restore are intentionally NOT added back to the
 * pools: within one restore each source row claims at most one pre-existing
 * row, and surplus source rows create fresh rows.
 *
 * @param {Array} rows        existing target rows to index
 * @param {(row: any) => any[]} argsOfRow  row -> key arguments (same shape the
 *                                         lookup will be called with)
 * @param {...args} keyFn     exact key builder
 * @param {...args} ciKeyFn   case-insensitive fallback key builder
 * @returns {(...args) => row | null}
 */
export function createMatcher(rows, argsOfRow, keyFn, ciKeyFn) {
  const byExact = new Map();
  const byCi = new Map();
  const consumed = new Set();

  const index = (map, key, row) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  const take = (map, key) => {
    const bucket = map.get(key);
    if (!bucket) return null;
    while (bucket.length) {
      const row = bucket.pop();
      if (!consumed.has(row.id)) {
        consumed.add(row.id);
        return row;
      }
    }
    return null;
  };

  for (const row of rows) {
    const args = argsOfRow(row);
    index(byExact, keyFn(...args), row);
    index(byCi, ciKeyFn(...args), row);
  }

  return (...args) => take(byExact, keyFn(...args)) || take(byCi, ciKeyFn(...args));
}
