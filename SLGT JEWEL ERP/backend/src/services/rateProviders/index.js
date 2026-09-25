/**
 * Rate Source Engine — dispatches a resolved source URL to the right provider
 * and returns a normalized rates object. New source types (a JSON API, a
 * JS-rendered site, etc.) are added here as another provider + a routing rule,
 * without touching the resolver or the sync/test callers above this layer.
 */
import { fetchDpGoldLiveRates, isDpGoldUrl } from '../dpGoldRateService.js';
import { fetchGenericRates } from './genericProvider.js';
import { assertSafeToFetch } from '../../utils/urlSafety.js';

/**
 * @param {string} url
 * @returns {Promise<{provider: 'dpgold'|'generic', rates: object}>}
 */
export async function fetchRatesFromSource(url, { timeoutMs = 10_000 } = {}) {
  await assertSafeToFetch(url);
  if (isDpGoldUrl(url)) {
    const rates = await fetchDpGoldLiveRates(url, { timeoutMs });
    return { provider: 'dpgold', rates };
  }
  const { rates } = await fetchGenericRates(url, { timeoutMs });
  return { provider: 'generic', rates };
}

export { isDpGoldUrl };
