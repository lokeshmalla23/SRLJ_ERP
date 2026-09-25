/**
 * Best-effort rate source provider for arbitrary admin-configured websites that
 * are NOT DP Gold. Since every jewellery-rate website has its own HTML/JSON
 * shape, this cannot guarantee extraction on any given site — it fetches the
 * page and looks for numbers near recognizable gold/silver/platinum labels,
 * either in a JSON response or in plain text extracted from HTML.
 *
 * Returns whatever subset of {gold_24k, gold_22k, gold_18k, silver, pure_silver,
 * platinum} it could find — callers must treat a partial/empty result as
 * "source didn't have this metal", not as an error.
 */

// Trade-standard purity constant used for 22K<->24K conversion — 0.9166, not the
// exact repeating fraction 22/24 (0.91666...7). Must be used for BOTH directions
// (24K = 22K / 0.9166, and 22K = 24K * 0.9166) so a round trip is exact and
// matches figures computed by hand the same way.
const PURITY_22K = 0.9166;
const KARAT_18_OF_24 = 18 / 24;
const SILVER_925_OF_999 = 925 / 999;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// A candidate number only counts if it's tagged as currency (₹/Rs/INR right before
// it) and NOT immediately followed by "%" — real-world testing against a live rate
// page turned up both failure modes directly: an unrelated "-0.52%" stock-ticker
// figure and a "(91.6% purity)" qualifier both sat closer to a karat label than the
// actual price, and got picked by an untagged nearest-number search. A price is
// always currency-marked on these pages; a percentage never is.
const CURRENCY_NUMBER_RE = /(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?!\s*(?:%|percent))/i;

/**
 * Collects the nearest currency-tagged number AFTER every match of `keywordRe`.
 * Forward-only: testing against a real page that mixes a "label then value" ticker
 * widget/table with "value then label" prose in the same document showed backward
 * search reliably grabs a neighboring label's value instead of this one's — forward
 * search plus frequency voting (below) is the more robust combination in practice.
 */
function collectNearKeyword(text, keywordRe, { afterChars = 80 } = {}) {
  const re = new RegExp(keywordRe.source, keywordRe.flags.includes('g') ? keywordRe.flags : `${keywordRe.flags}g`);
  const found = [];
  let match;
  while ((match = re.exec(text))) {
    const matchEnd = match.index + match[0].length;
    const afterText = text.slice(matchEnd, matchEnd + afterChars);
    const afterMatch = afterText.match(CURRENCY_NUMBER_RE);
    if (afterMatch) {
      const num = Number(afterMatch[1].replace(/,/g, ''));
      if (Number.isFinite(num) && num > 0) found.push(num);
    }
  }
  return found;
}

/**
 * A single incidental mention (an FAQ title, a partner-content date, an unrelated
 * "platinum" byline, a neighboring metal's value in a prose list) produces a
 * one-off number. The real rate is usually echoed by more than one widget/table on
 * the page, so the most-repeated candidate wins. A tie between two DIFFERENT values
 * (e.g. one widget agrees with itself once, a prose sentence disagrees once) means
 * there isn't enough evidence to pick a side — returning null ("not detected") is
 * safer than silently guessing one of two plausible-looking but conflicting prices.
 */
function pickMostRepeated(candidates) {
  if (!candidates.length) return null;
  const counts = new Map();
  for (const n of candidates) counts.set(n, (counts.get(n) || 0) + 1);
  const maxCount = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v);
  return winners.length === 1 ? winners[0] : null;
}

function extractNearKeyword(text, keywordRe, opts) {
  return pickMostRepeated(collectNearKeyword(text, keywordRe, opts));
}

// Deliberately no bare "gold"/"silver" fallback: without a karat/fineness qualifier
// anchoring the match, the nearest number to the keyword can just as easily be the
// purity label itself (e.g. the "999" in "Silver 999 ₹195500") rather than the
// price, which would silently store a wrong rate. Jewellery rate sites virtually
// always label purity, so requiring it here trades a bit of recall for correctness.
// Karat can appear as "24K", "24 K", or spelled out ("24 karat"/"24 carat").
const PATTERNS = {
  gold_24k: /gold[^a-z0-9]{0,15}24\s*(?:k\b|karat|carat)|24\s*(?:k\b|karat|carat)[^a-z0-9]{0,15}gold|gold[^a-z0-9]{0,10}999(?!\s*silver)|999[^a-z0-9]{0,10}gold(?!\s*silver)/i,
  gold_22k: /gold[^a-z0-9]{0,15}22\s*(?:k\b|karat|carat)|22\s*(?:k\b|karat|carat)[^a-z0-9]{0,15}gold/i,
  gold_18k: /gold[^a-z0-9]{0,15}18\s*(?:k\b|karat|carat)|18\s*(?:k\b|karat|carat)[^a-z0-9]{0,15}gold/i,
  pure_silver: /(?:pure|fine)[^a-z0-9]{0,10}silver|silver[^a-z0-9]{0,10}999|999[^a-z0-9]{0,10}silver/i,
  silver_925: /silver[^a-z0-9]{0,10}925|925[^a-z0-9]{0,10}silver/i,
  // The optional "PT950" tail is consumed as part of the match (when present) so the
  // number search starts after it, not after the bare word "platinum" — otherwise the
  // "950" purity marker itself gets mistaken for the price, same failure mode as gold/silver above.
  platinum: /platinum(?:[^a-z0-9]{0,10}pt[^a-z0-9]{0,4}950)?|pt[^a-z0-9]{0,4}950/i,
  // Fallback-only, unqualified mentions — see extractFromText. Real testing found a
  // live site that quotes silver as a flat "Silver ₹265/g" with no purity label at
  // all. Safe to use now (unlike the removed bare gold/silver fallback further up)
  // because currency-anchoring rejects bare purity digits and frequency-voting
  // rejects one-off incidental mentions — the failure mode that justified banning
  // bare fallbacks in the first place no longer applies once those two are in place.
  // No bare "gold" fallback: an unqualified gold mention can't tell you WHICH karat
  // it refers to, so there's no safe field to assign it to.
  silver_bare: /\bsilver\b/i,
  platinum_bare: /\bplatinum\b/i,
};

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    // Many sites encode ₹ as a numeric entity (&#x20b9; / &#8377;) rather than the
    // literal character — decode numeric entities generally so the currency-anchor
    // check above (which requires a literal ₹/Rs/INR right before the number) can
    // actually see it. Must run before &amp; so a literal "&#x26;" isn't double-decoded.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

function flattenJson(value, path, out) {
  if (value == null) return;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    out.push({ path: path.toLowerCase(), value });
    return;
  }
  if (typeof value === 'string') {
    const num = Number(value.replace(/,/g, ''));
    if (Number.isFinite(num) && num > 0) out.push({ path: path.toLowerCase(), value: num });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenJson(v, `${path}.${i}`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenJson(v, path ? `${path}.${k}` : k, out);
  }
}

function extractFromJson(json) {
  const flat = [];
  flattenJson(json, '', flat);
  const findBy = (re) => flat.find((f) => re.test(f.path))?.value ?? null;
  const found = {
    gold_24k: findBy(/gold.*(24|999)|(24|999).*gold/i),
    gold_22k: findBy(/gold.*22|22.*gold/i),
    gold_18k: findBy(/gold.*18|18.*gold/i),
    pure_silver: findBy(/(pure|fine).*silver|silver.*999|999.*silver/i),
    silver: findBy(/silver.*925|925.*silver/i),
    platinum: findBy(/platinum|pt.?950/i),
  };
  // An unqualified "silver" mention (no 925/999 label at all) is the 999/pure rate
  // on the real sites this was tested against — not a 925 rate. Assign it to
  // pure_silver, not silver, so the 925 figure gets correctly DERIVED from it below
  // rather than the other way around.
  if (found.silver == null && found.pure_silver == null) found.pure_silver = findBy(/silver/i);
  if (found.platinum == null) found.platinum = findBy(/platinum/i);
  return found;
}

function extractFromText(text) {
  const found = {
    gold_24k: extractNearKeyword(text, PATTERNS.gold_24k),
    gold_22k: extractNearKeyword(text, PATTERNS.gold_22k),
    gold_18k: extractNearKeyword(text, PATTERNS.gold_18k),
    pure_silver: extractNearKeyword(text, PATTERNS.pure_silver),
    silver: extractNearKeyword(text, PATTERNS.silver_925),
    platinum: extractNearKeyword(text, PATTERNS.platinum),
  };
  // Same reasoning as extractFromJson above: an unqualified "Silver ₹265/g" mention
  // is the 999/pure rate on real sites tested, so it's the pure_silver anchor —
  // 925 is derived from it, not the reverse.
  if (found.silver == null && found.pure_silver == null) {
    found.pure_silver = extractNearKeyword(text, PATTERNS.silver_bare);
  }
  if (found.platinum == null) {
    found.platinum = extractNearKeyword(text, PATTERNS.platinum_bare);
  }
  return found;
}

// Sanity bounds (₹/gram) a detected number must fall within to be accepted as a real
// rate rather than incidental page noise (a date, a percentage, an ad/counter value,
// or — as observed against a real third-party rate page during testing — a stray
// digit sitting near a karat label that isn't the price at all). Wide enough to cover
// realistic price movement, tight enough to reject obviously-wrong matches.
const PLAUSIBLE_RANGE = {
  gold_24k: [1000, 50000],
  gold_22k: [900, 46000],
  gold_18k: [700, 38000],
  pure_silver: [10, 5000],
  silver: [10, 5000],
  platinum: [500, 25000],
};

function sanitizeFound(found) {
  const out = {};
  for (const [key, value] of Object.entries(found)) {
    const range = PLAUSIBLE_RANGE[key];
    out[key] = (value != null && range && value >= range[0] && value <= range[1]) ? value : null;
  }
  return out;
}

/**
 * 22K is the rate virtually every Indian retail site quotes reliably (it's the
 * trade-standard retail purity) — real-world testing found a direct 24K match is
 * the least reliable of the three on several real page layouts. So 22K is the
 * trusted anchor: 24K = 22K / 0.9166 (91.66% purity), i.e. 22K × 24/22, and 18K is
 * derived from that same base. Direct 24K/18K matches are only used as a fallback
 * when no 22K was found at all.
 */
function resolveGoldBase(found) {
  if (found.gold_22k) return found.gold_22k / PURITY_22K;
  if (found.gold_24k) return found.gold_24k;
  if (found.gold_18k) return found.gold_18k / KARAT_18_OF_24;
  return null;
}

/** Fills in every gold purity from whichever karat(s) were actually found, and
 *  derives the missing silver purity from whichever one was found. */
function normalizeFound(rawFound) {
  const found = sanitizeFound(rawFound);
  const out = {};

  const goldBase = resolveGoldBase(found);
  if (goldBase != null) {
    out.gold_24k = round2(goldBase);
    out.gold_22k = round2(goldBase * PURITY_22K);
    out.gold_18k = round2(goldBase * KARAT_18_OF_24);
  }

  let pureSilver = found.pure_silver;
  let silver925 = found.silver;
  if (!pureSilver && silver925) pureSilver = silver925 / SILVER_925_OF_999;
  if (!silver925 && pureSilver) silver925 = pureSilver * SILVER_925_OF_999;
  if (pureSilver) out.pure_silver = round2(pureSilver);
  if (silver925) out.silver = round2(silver925);

  if (found.platinum) out.platinum = round2(found.platinum);
  return out;
}

/**
 * @param {string} url
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{rates: object, raw: 'json'|'html', foundCount: number}>}
 */
export async function fetchGenericRates(url, { timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text;
  let contentType = '';
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some public rate pages block requests that self-identify as a script/bot
        // via User-Agent (observed against goodreturns.in during testing — our
        // original tool UA got HTTP 403, a standard browser UA got 200 on the same
        // URL). This is a normal browser UA for reading a public page, not evasion
        // of any real bot-challenge (CAPTCHA/JS-challenge sites still won't work).
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
    contentType = res.headers.get('content-type') || '';
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let found;
  let raw;
  if (contentType.includes('application/json') || /^\s*[[{]/.test(text)) {
    try {
      found = extractFromJson(JSON.parse(text));
      raw = 'json';
    } catch {
      found = extractFromText(htmlToText(text));
      raw = 'html';
    }
  } else {
    found = extractFromText(htmlToText(text));
    raw = 'html';
  }

  const rates = normalizeFound(found);
  const foundCount = Object.keys(rates).length;
  if (foundCount === 0) {
    throw new Error('Could not detect any gold/silver/platinum rate on this page — the site format is not recognized');
  }
  return { rates, raw, foundCount };
}
