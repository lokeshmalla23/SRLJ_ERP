import { useEffect, useState } from "react";

/** In-memory unlock for the Customers module (list + detail). Clears on reload. */
let unlocked = false;
const listeners = new Set();

export function isCustomersHiddenUnlocked() {
  return unlocked;
}

export function setCustomersHiddenUnlocked(next) {
  unlocked = Boolean(next);
  listeners.forEach((fn) => {
    try { fn(unlocked); } catch { /* */ }
  });
}

export function useCustomersHiddenUnlocked() {
  const [value, setValue] = useState(unlocked);
  useEffect(() => {
    const fn = (v) => setValue(v);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return [value, setCustomersHiddenUnlocked];
}
