/**
 * Branch Service runtime configuration.
 * Loaded when APP_MODE=branch (and usable in cloud for shared fields).
 *
 * Secrets come from environment / local config file — never hardcoded.
 * Optional file: BRANCH_CONFIG_PATH or <repo>/backend/config/branch.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { APP_MODE, isBranchMode } from './appMode.js';
import { SCHEMA_VERSION } from './schemaVersion.js';

import { writablePath } from './writablePaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`branchConfig: failed to read ${filePath}: ${err.message}`);
    return {};
  }
}

function defaultConfigPath() {
  if (process.env.BRANCH_CONFIG_PATH) return process.env.BRANCH_CONFIG_PATH;
  // Packaged Electron: never write under Program Files
  if (process.env.ELECTRON_USERDATA) {
    return writablePath('config', 'branch.json');
  }
  return path.resolve(__dirname, '../../config/branch.json');
}

function loadFileConfig() {
  return readJsonFile(defaultConfigPath());
}

function resolveDeviceId(fileCfg) {
  return (
    process.env.DEVICE_ID
    || fileCfg.device_id
    || fileCfg.device_identifier
    || null
  );
}

function ensureDeviceIdPersisted(fileCfg, deviceId) {
  if (!isBranchMode()) return deviceId;
  if (deviceId) return deviceId;

  const generated = randomUUID();
  const cfgPath = defaultConfigPath();
  const dir = path.dirname(cfgPath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const next = {
      ...fileCfg,
      device_id: generated,
      device_name: fileCfg.device_name || process.env.COMPUTERNAME || 'Branch Host',
      role: fileCfg.role || 'active_host',
      created_at: new Date().toISOString(),
    };
    // Do not write secrets into this file.
    delete next.database_url;
    delete next.database_password;
    delete next.jwt_secret;
    fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2), { mode: 0o600 });
    console.log(`branchConfig: generated device_id and wrote ${cfgPath}`);
    return generated;
  } catch (err) {
    console.warn(`branchConfig: could not persist device_id: ${err.message}`);
    return generated;
  }
}

const fileCfg = loadFileConfig();
const deviceId = ensureDeviceIdPersisted(fileCfg, resolveDeviceId(fileCfg));

/**
 * Public branch identity + listen settings (safe to expose via health).
 */
export const branchConfig = Object.freeze({
  app_mode: APP_MODE,
  schema_version: SCHEMA_VERSION,
  shop_id: process.env.SHOP_ID || fileCfg.shop_id || null,
  device_id: deviceId,
  device_name: process.env.DEVICE_NAME || fileCfg.device_name || process.env.COMPUTERNAME || 'Branch Host',
  role: process.env.BRANCH_ROLE || fileCfg.role || (isBranchMode() ? 'active_host' : 'cloud'),
  listen_host: process.env.LISTEN_HOST || fileCfg.listen_host || (isBranchMode() ? '0.0.0.0' : '127.0.0.1'),
  listen_port: Number(process.env.PORT || fileCfg.listen_port || 8080),
  cloud_endpoint: process.env.CLOUD_ENDPOINT || fileCfg.cloud_endpoint || null,
  device_number: Number(process.env.DEVICE_NUMBER || fileCfg.device_number || 1),
  local_api_port: Number(process.env.PORT || fileCfg.local_api_port || 8080),
  config_path: defaultConfigPath(),
});

export function getPublicBranchStatus() {
  return {
    app_mode: branchConfig.app_mode,
    schema_version: branchConfig.schema_version,
    shop_id: branchConfig.shop_id,
    device_id: branchConfig.device_id,
    device_name: branchConfig.device_name,
    role: branchConfig.role,
    listen_host: branchConfig.listen_host,
    listen_port: branchConfig.listen_port,
    cloud_endpoint_configured: Boolean(branchConfig.cloud_endpoint),
  };
}

export default branchConfig;
