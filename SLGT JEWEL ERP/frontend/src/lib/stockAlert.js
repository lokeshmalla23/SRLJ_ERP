import api from "@/lib/api";

/**
 * Sound played in POS/Estimation when adding a product would exceed its
 * available stock (e.g. only 1 in stock and it's already on the bill).
 * Fetched once per session and cached — Settings → Company Profile →
 * Stock Alert Sound is where it's uploaded.
 */
let cachedSrc = null;
let fetchPromise = null;

async function loadStockAlertSound() {
  if (cachedSrc !== null) return cachedSrc;
  if (!fetchPromise) {
    fetchPromise = api.get("/settings/stock-alert-sound")
      .then(({ data }) => {
        cachedSrc = data?.stock_alert_sound || "";
        return cachedSrc;
      })
      .catch(() => {
        cachedSrc = "";
        return "";
      });
  }
  return fetchPromise;
}

export async function playStockAlertSound() {
  try {
    const src = await loadStockAlertSound();
    if (!src) return;
    const audio = new Audio(src);
    audio.volume = 0.6;
    await audio.play().catch(() => {});
  } catch {
    /* non-fatal — the popup itself is the important part */
  }
}

/** Call after saving a new sound in Settings so the next alert uses it right away. */
export function invalidateStockAlertSoundCache() {
  cachedSrc = null;
  fetchPromise = null;
}
