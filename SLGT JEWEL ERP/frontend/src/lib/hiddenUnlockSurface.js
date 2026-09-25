/** Page wash while hidden bills are unlocked (owner view) or POS is writing hidden bills. */
export const HIDDEN_UNLOCK_BG = "#F6F4FB";
export const HIDDEN_UNLOCK_EDGE = "#DDD6FE";

/** Full-bleed fill for pages inside AppShell `main.p-5 xl:p-7` — must mirror the shell padding exactly. */
export const HIDDEN_UNLOCK_BLEED_CLASS =
  "-mx-5 -my-5 px-5 py-5 min-h-[calc(100vh-4rem)] bg-[#F6F4FB] [box-shadow:inset_0_3px_0_0_#DDD6FE] xl:-mx-7 xl:-my-7 xl:px-7 xl:py-7";

export function hiddenUnlockBleedClass(unlocked) {
  return unlocked ? HIDDEN_UNLOCK_BLEED_CLASS : "";
}
