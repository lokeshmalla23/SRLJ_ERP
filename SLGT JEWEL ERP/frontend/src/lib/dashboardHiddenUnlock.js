import { useEffect, useState } from "react";

/** In-memory unlock for the Dashboard's hidden-bill figures (clears on app reload). */
let unlocked = false;
const listeners = new Set();

export function isDashboardHiddenUnlocked() {
  return unlocked;
}

export function setDashboardHiddenUnlocked(next) {
  unlocked = Boolean(next);
  listeners.forEach((fn) => {
    try { fn(unlocked); } catch { /* */ }
  });
}

export function useDashboardHiddenUnlocked() {
  const [value, setValue] = useState(unlocked);
  useEffect(() => {
    const fn = (v) => setValue(v);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return [value, setDashboardHiddenUnlocked];
}
