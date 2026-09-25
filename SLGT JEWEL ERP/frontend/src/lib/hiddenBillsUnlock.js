import { useEffect, useState } from "react";

/** In-memory unlock for Hidden Bills nav (clears when leaving the page / closing dialog). */
let unlocked = false;
const listeners = new Set();

export function isHiddenBillsUnlocked() {
  return unlocked;
}

export function setHiddenBillsUnlocked(next) {
  unlocked = Boolean(next);
  listeners.forEach((fn) => {
    try { fn(unlocked); } catch { /* */ }
  });
}

export function useHiddenBillsUnlocked() {
  const [value, setValue] = useState(unlocked);
  useEffect(() => {
    const fn = (v) => setValue(v);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return [value, setHiddenBillsUnlocked];
}
