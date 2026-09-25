/** HashRouter-safe navigation for Electron file:// builds. */

export function appNavigate(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  // Prefer react-router when available via full page hash change
  window.location.hash = `#${p}`;
}

export function appLoginPath() {
  return "#/login";
}

export function currentAppPath() {
  const hash = window.location.hash || "";
  if (hash.startsWith("#")) {
    const raw = hash.slice(1);
    return raw.split("?")[0] || "/";
  }
  return window.location.pathname || "/";
}
