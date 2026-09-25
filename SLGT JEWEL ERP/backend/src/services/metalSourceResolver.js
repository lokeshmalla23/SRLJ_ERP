/**
 * Central resolution logic for "which URL should the ERP fetch live rates from,
 * for a given metal?" — kept in one place so every caller (auto-sync tick, manual
 * sync button, Test Sources) applies the exact same override rule.
 *
 * Rule: an individual metal URL always wins over the "All in One" URL; when the
 * individual URL is empty, the metal falls back to "All in One".
 */

export const METALS = ['gold', 'silver', 'platinum'];

export function normalizeMetalPriceSources(raw = {}) {
  const v = raw && typeof raw === 'object' ? raw : {};
  return {
    all_in_one: String(v.all_in_one || '').trim(),
    gold: String(v.gold || '').trim(),
    silver: String(v.silver || '').trim(),
    platinum: String(v.platinum || '').trim(),
  };
}

/** Returns the resolved URL for one metal, or '' if nothing is configured for it. */
export function resolveMetalSourceUrl(sources, metal) {
  const s = normalizeMetalPriceSources(sources);
  const individual = s[metal] || '';
  return individual || s.all_in_one || '';
}

/** Returns { gold: url|'', silver: url|'', platinum: url|'' }. */
export function resolveAllMetalSources(sources) {
  const out = {};
  for (const metal of METALS) out[metal] = resolveMetalSourceUrl(sources, metal);
  return out;
}

export function hasAnySourceConfigured(sources) {
  const s = normalizeMetalPriceSources(sources);
  return Boolean(s.all_in_one || s.gold || s.silver || s.platinum);
}

/**
 * Groups metals by the URL they resolve to, so a source shared by multiple
 * metals (e.g. "All in One" used for all three) is only fetched once.
 * Returns a Map<url, metal[]>, skipping metals with no resolved URL.
 */
export function groupMetalsByResolvedUrl(sources) {
  const resolved = resolveAllMetalSources(sources);
  const groups = new Map();
  for (const metal of METALS) {
    const url = resolved[metal];
    if (!url) continue;
    if (!groups.has(url)) groups.set(url, []);
    groups.get(url).push(metal);
  }
  return groups;
}
