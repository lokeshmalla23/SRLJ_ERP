/**
 * DP Gold rate-source provider — pulls live gold/silver rates from DP Gold's
 * public rate-ticker feed (the same endpoint their homepage widget polls — no
 * API key, undocumented, so this can break silently if they change their
 * template/format). This is one of several source providers dispatched by
 * ./rateProviders/index.js; it is no longer the only supported source.
 */

export const DPGOLD_FEED_URL =
  'https://statewisebcast.dpgold.in:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/dpgold';

const GOLD_999_RE = /^GOLD\s+999\s+BIS/i;
const GOLD_IMPORTED_999_RE = /^GOLD\s+IMPORTED\s+999/i;
const SILVER_KG_RE = /^SILVER\s+\d+\s*KG/i;

const KARAT_24 = 24;
const KARAT_22 = 22;
const KARAT_18 = 18;
const SILVER_FINE_999 = 999;
const SILVER_STANDARD_925 = 925;

/** True if a configured source URL is DP Gold's feed (any host containing "dpgold"). */
export function isDpGoldUrl(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().includes('dpgold');
  } catch {
    return false;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseFeedRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 5);
}

/**
 * @param {string} [url] Feed URL to fetch — defaults to the well-known DP Gold
 *   feed, but callers can pass a company-configured DP Gold URL instead.
 */
export async function fetchDpGoldLiveRates(url = DPGOLD_FEED_URL, { timeoutMs = 10_000 } = {}) {
  const feedUrl = url || DPGOLD_FEED_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text;
  try {
    const res = await fetch(`${feedUrl}${feedUrl.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SLGT-Jewellery-ERP-LiveRateSync/1.0' },
    });
    if (!res.ok) throw new Error(`DP Gold feed returned HTTP ${res.status}`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const rows = parseFeedRows(text);
  const findRow = (re) => rows.find((cols) => re.test((cols[2] || '').trim()));

  const goldRow = findRow(GOLD_999_RE) || findRow(GOLD_IMPORTED_999_RE);
  const silverRow = findRow(SILVER_KG_RE);
  if (!goldRow || !silverRow) {
    throw new Error('DP Gold feed format changed — could not locate gold/silver rows');
  }

  // Column 4 (index 4) is the "ask"/display rate — matches what the DP Gold widget shows on-page.
  // DP Gold quotes this row directly as the 24K (999) rate per gram — no per-10g conversion needed.
  const gold24k = Number(goldRow[4]);
  const silverPerKg = Number(silverRow[4]);
  if (!Number.isFinite(gold24k) || !Number.isFinite(silverPerKg)) {
    throw new Error('DP Gold feed returned non-numeric rates');
  }

  // 999-fine silver rate, per gram.
  const pureSilver = round2(silverPerKg / 1000);

  return {
    gold_24k: round2(gold24k),
    gold_22k: round2((KARAT_22 / KARAT_24) * gold24k),
    gold_18k: round2((KARAT_18 / KARAT_24) * gold24k),
    // "silver" is standard 925-purity silver, derived from the 999-fine rate.
    silver: round2((SILVER_STANDARD_925 / SILVER_FINE_999) * pureSilver),
    pure_silver: pureSilver,
  };
}
