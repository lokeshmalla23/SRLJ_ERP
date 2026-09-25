const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const defaultConfig = {
  setup_complete: false,
  mode: 'host', // host | join
  role: 'active_host', // active_host | replica
  branch_api_url: 'http://127.0.0.1:8080', // UI API target (host LAN URL on join)
  host_api_url: null, // remote host when mode=join (legacy — prefer last_known_host_url)
  local_api_url: 'http://127.0.0.1:8080', // embedded replica/host service
  // ── Host location hints (never authoritative — IP can change via DHCP) ──
  last_known_host_url:       null, // last verified host API URL
  last_known_host_device_id: null, // host device_id for identity matching
  last_known_host_term:      0,    // last observed Raft host_term
  // ────────────────────────────────────────────────────────────────────────
  shop_name: null,
  shop_id: null,
  device_id: null,
  device_name: null,
  device_number: 1,
  event_watermark: 0,
  printer_prefs: {},
  config_version: 1,
};

function configPath() {
  return path.join(app.getPath('userData'), 'desktop-config.json');
}

function loadConfig() {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return { ...defaultConfig };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const cfg = { ...defaultConfig, ...raw };

    const rewriteLoopback8000 = (url) => {
      const s = String(url || '');
      if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):8000\/?$/i.test(s)) {
        return s.replace(/:8000/i, ':8080').replace(/\/$/, '');
      }
      return url;
    };
    const rewrittenLocal = rewriteLoopback8000(cfg.local_api_url);
    const rewrittenBranch = rewriteLoopback8000(cfg.branch_api_url);
    if (rewrittenLocal !== cfg.local_api_url || rewrittenBranch !== cfg.branch_api_url) {
      cfg.local_api_url = rewrittenLocal;
      cfg.branch_api_url = rewrittenBranch;
      try {
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
      } catch { /* non-fatal */ }
    }

    // ── Migration v1 → v2: promote old host_api_url to last_known_host_url ──
    if (!cfg.config_version || cfg.config_version < 2) {
      const legacyUrl = cfg.host_api_url || cfg.branch_api_url;
      // Only promote if it looks like a real LAN address (not loopback)
      if (legacyUrl && !legacyUrl.includes('127.0.0.1') && !legacyUrl.includes('localhost')) {
        cfg.last_known_host_url = cfg.last_known_host_url || legacyUrl;
      }
      cfg.config_version = 2;
      // Persist the migration silently
      try {
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
      } catch { /* non-fatal */ }
    }

    return cfg;
  } catch {
    return { ...defaultConfig };
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch, updated_at: new Date().toISOString() };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return publicConfig(next);
}

function publicConfig(next) {
  return {
    setup_complete:            Boolean(next.setup_complete),
    mode:                      next.mode,
    role:                      next.role || (next.mode === 'join' ? 'replica' : 'active_host'),
    branch_api_url:            next.branch_api_url,
    host_api_url:              next.host_api_url || null,
    local_api_url:             next.local_api_url || 'http://127.0.0.1:8080',
    last_known_host_url:       next.last_known_host_url || null,
    last_known_host_device_id: next.last_known_host_device_id || null,
    last_known_host_term:      next.last_known_host_term || 0,
    shop_name:                 next.shop_name,
    shop_id:                   next.shop_id || null,
    device_id:                 next.device_id || null,
    device_name:               next.device_name,
    device_number:             next.device_number || 1,
    event_watermark:           next.event_watermark || 0,
    printer_prefs:             next.printer_prefs || {},
    config_version:            next.config_version || 2,
  };
}

module.exports = { loadConfig, saveConfig, defaultConfig, publicConfig };
