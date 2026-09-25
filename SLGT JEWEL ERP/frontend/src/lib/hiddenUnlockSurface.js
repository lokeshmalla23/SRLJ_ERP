/** Page wash while hidden bills are unlocked (owner view) or POS is writing hidden bills. */
export const HIDDEN_UNLOCK_BG = "#F6F4FB";
export const HIDDEN_UNLOCK_EDGE = "#DDD6FE";

/** Full-bleed fill for pages inside AppShell `main.p-8`. */
export const HIDDEN_UNLOCK_BLEED_CLASS =
  "-mx-8 -my-8 px-8 py-8 min-h-[calc(100vh-4rem)] bg-[#F6F4FB] [box-shadow:inset_0_3px_0_0_#DDD6FE]";

export function hiddenUnlockBleedClass(unlocked) {
  return unlocked ? HIDDEN_UNLOCK_BLEED_CLASS : "";
}
