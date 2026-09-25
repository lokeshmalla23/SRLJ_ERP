/**
 * Generalized live metal-rate sync — replaces the old DP-Gold-only scheduler.
 * Reads the company's configured Metal Price Sources, resolves a URL per metal
 * (metalSourceResolver.js), fetches through the provider dispatcher
 * (rateProviders/index.js), and writes the result into the same `gold_rate`
 * Setting / GoldRateHistory audit trail the rest of the app already reads.
 *
 * On any fetch/parse failure the previously stored rate for that field is left
 * untouched — a source outage never zeroes out a live rate used for billing.
 */
import { Setting, GoldRateHistory } from '../models/index.js';
import sequelize from '../db.js';
import { newId, nowIso } from '../utils.js';
import branchConfig from '../config/branchConfig.js';
import { upsertSetting, asObject } from './settingsStore.js';
import { logger } from '../utils/logger.js';
import { DPGOLD_FEED_URL } from './dpGoldRateService.js';
import { fetchRatesFromSource } from './rateProviders/index.js';
import {
  METALS,
  normalizeMetalPriceSources,
  resolveAllMetalSources,
  hasAnySourceConfigured,
  groupMetalsByResolvedUrl,
} from './metalSourceResolver.js';

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fetches each distinct resolved URL once and folds results into per-metal rate fields. */
async function fetchAndMergeRates(sources) {
  const groups = groupMetalsByResolvedUrl(sources);
  const collected = {};
  const errors = [];
  for (const [url, metals] of groups) {
    let rates;
    try {
      ({ rates } = await fetchRatesFromSource(url));
    } catch (err) {
      for (const metal of metals) errors.push(`${capitalize(metal)}: ${err.message}`);
      continue;
    }
    for (const metal of metals) {
      if (metal === 'gold') {
        const got = rates.gold_24k != null || rates.gold_22k != null || rates.gold_18k != null;
        if (rates.gold_24k != null) collected.gold_24k = rates.gold_24k;
        if (rates.gold_22k != null) collected.gold_22k = rates.gold_22k;
        if (rates.gold_18k != null) collected.gold_18k = rates.gold_18k;
        if (!got) errors.push(`Gold: no gold rate detected at this source`);
      } else if (metal === 'silver') {
        const got = rates.silver != null || rates.pure_silver != null;
        if (rates.silver != null) collected.silver = rates.silver;
        if (rates.pure_silver != null) collected.pure_silver = rates.pure_silver;
        if (!got) errors.push(`Silver: no silver rate detected at this source`);
      } else if (metal === 'platinum') {
        if (rates.platinum != null) collected.platinum = rates.platinum;
        else errors.push(`Platinum: no platinum rate detected at this source`);
      }
    }
  }
  return { collected, errors };
}

/**
 * One-time, self-healing migration for installs that had DP Gold live-sync
 * enabled before Metal Price Sources existed: seeds "All in One" with the
 * known DP Gold feed so live rates keep flowing, and so the URL becomes
 * visible/editable in Settings → Company Profile going forward. No-ops once
 * `metal_price_sources` has been saved at least once (even if left empty).
 */
function resolveSourcesWithLegacyFallback(companyValue) {
  if (companyValue.metal_price_sources != null) {
    return { sources: normalizeMetalPriceSources(companyValue.metal_price_sources), needsBackfill: false };
  }
  return { sources: normalizeMetalPriceSources({ all_in_one: DPGOLD_FEED_URL }), needsBackfill: true };
}

/** Fetches live rates for the configured sources, upserts gold_rate, and logs a GoldRateHistory row. */
export async function applyMetalRateSync({ shopId, changedBy = null, source = 'live_auto' }) {
  // Network fetches happen outside any DB transaction — a slow/hanging source
  // must never hold a write transaction (and, on SQLite, the whole DB) open.
  const companySetting = await Setting.findOne({ where: { key: 'company' } });
  const companyValue = asObject(companySetting?.value);
  const companyShopId = companySetting?.shop_id ?? shopId;
  const { sources, needsBackfill } = resolveSourcesWithLegacyFallback(companyValue);

  if (!hasAnySourceConfigured(sources)) {
    const t = await sequelize.transaction();
    try {
      const value = await upsertSetting('gold_rate', {
        live_rate_last_error: 'No metal price source configured — set at least one URL in Settings → Company → Company Profile → Metal Price Sources.',
      }, shopId, t);
      await t.commit();
      return { value, error: 'No metal price source configured' };
    } catch (err) {
      await t.rollback();
      return { value: null, error: err.message };
    }
  }

  const { collected, errors } = await fetchAndMergeRates(sources);
  const errorSummary = errors.length ? errors.join('; ') : null;

  const t = await sequelize.transaction();
  try {
    if (needsBackfill) {
      await upsertSetting('company', { metal_price_sources: sources }, companyShopId, t);
      logger.info('metal-rate-sync', 'backfilled legacy DP Gold source into company.metal_price_sources');
    }

    const patch = { ...collected, live_rate_last_error: errorSummary, updated_at: nowIso() };
    if (Object.keys(collected).length) patch.live_rate_last_synced_at = nowIso();
    const value = await upsertSetting('gold_rate', patch, shopId, t);

    if (Object.keys(collected).length) {
      await GoldRateHistory.create({
        id: newId(),
        shop_id: shopId,
        rates: value,
        changed_by: changedBy,
        source,
        origin_device_id: branchConfig.device_id || null,
      }, { transaction: t });
    }
    await t.commit();
    return { value, error: errorSummary };
  } catch (err) {
    await t.rollback();
    return { value: null, error: err.message };
  }
}

/** Called on a timer from index.js — only actually syncs when the live-rate toggle is on. */
export async function runMetalRateAutoSyncTick() {
  const setting = await Setting.findOne({ where: { key: 'gold_rate' } });
  const value = asObject(setting?.value);
  if (!value.live_rate_enabled) return;
  const { error } = await applyMetalRateSync({ shopId: setting?.shop_id || null, source: 'live_auto' });
  if (error) logger.warn('metal-rate-sync', 'auto sync failed', { error });
}

/**
 * Tests configured (or draft, unsaved) sources without touching the live
 * gold_rate setting or history. Reports per input slot (all_in_one/gold/
 * silver/platinum) so the UI can show exactly what Settings → Company Profile
 * displays.
 */
const FIELDS_FOR_METAL = {
  gold: ['gold_24k', 'gold_22k', 'gold_18k'],
  silver: ['silver', 'pure_silver'],
  platinum: ['platinum'],
};

/** Drops fields the requested slot isn't responsible for — a shared sitewide ticker
 *  widget can leak an unrelated metal's rate into the same page fetch (observed
 *  against a real site during testing), which would otherwise show as a confusing
 *  "gold rate" preview under a Silver source test. */
function previewFor(rates, servesMetals) {
  if (!rates) return null;
  const allowed = new Set(servesMetals.flatMap((m) => FIELDS_FOR_METAL[m]));
  const out = {};
  for (const [key, value] of Object.entries(rates)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

export async function testMetalSources(rawSources) {
  const sources = normalizeMetalPriceSources(rawSources);
  const resolved = resolveAllMetalSources(sources);
  const cache = new Map(); // url -> { rates, error }

  async function fetchOnce(url) {
    if (cache.has(url)) return cache.get(url);
    let entry;
    try {
      const { rates, provider } = await fetchRatesFromSource(url);
      entry = { rates, provider, error: null };
    } catch (err) {
      entry = { rates: null, provider: null, error: err.message };
    }
    cache.set(url, entry);
    return entry;
  }

  const results = [];
  for (const slot of ['all_in_one', ...METALS]) {
    const url = sources[slot];
    if (!url) continue;
    const servesMetals = slot === 'all_in_one'
      ? METALS.filter((m) => resolved[m] === url && !sources[m])
      : [slot];
    const { rates, provider, error } = await fetchOnce(url);
    const metalChecks = servesMetals.map((metal) => {
      if (error) return { metal, ok: false, detail: error };
      if (metal === 'gold') {
        const ok = rates.gold_24k != null || rates.gold_22k != null || rates.gold_18k != null;
        return { metal, ok, detail: ok ? null : 'No gold rate detected' };
      }
      if (metal === 'silver') {
        const ok = rates.silver != null || rates.pure_silver != null;
        return { metal, ok, detail: ok ? null : 'No silver rate detected' };
      }
      const ok = rates.platinum != null;
      return { metal, ok, detail: ok ? null : 'No platinum rate detected' };
    });
    results.push({
      slot,
      url,
      provider,
      reachable: !error,
      error,
      metals: metalChecks,
      preview: previewFor(rates, servesMetals),
    });
  }
  return { results };
}
