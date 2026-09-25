/**
 * Device authorization + join for multi-PC (Host approval required; not open LAN trust).
 * Device authorization (PC allowed?) is separate from employee authentication (who is logged in).
 */
import fs from 'fs';
import path from 'path';
import { Device, Shop, Setting, User } from '../models/index.js';
import { newId, verifyPassword, createToken } from '../utils.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import branchConfig from '../config/branchConfig.js';
import { discoverBranchHosts, buildAdvertisement, discoverJoinReadyDevices, startJoinReadyAdvertiser, stopJoinReadyAdvertiser } from '../services/lanDiscovery.js';
import { isBranchMode } from '../config/appMode.js';
import { fenceThisNode } from '../services/clusterService.js';
import crypto from 'crypto';
import sequelize from '../db.js';
import { Op } from 'sequelize';
import { normalizePermissionsObject } from '../permissions.js';
import { isDeviceApprovedStatus } from './deviceAuthorization.js';

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const PAIRING_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BOOTSTRAP_TTL_MS = 15 * 60 * 1000;

function pairingStorePath() {
  if (process.env.SQLITE_PATH) {
    return path.join(path.dirname(process.env.SQLITE_PATH), 'pairing-codes.json');
  }
  if (process.env.ELECTRON_USERDATA) {
    return path.join(process.env.ELECTRON_USERDATA, 'data', 'pairing-codes.json');
  }
  return path.join(process.cwd(), 'pairing-codes.json');
}

function loadPairingStore() {
  const file = pairingStorePath();
  try {
    if (!fs.existsSync(file)) return { codes: {}, tokens: {}, devicePins: {}, claims: {}, requestAt: {} };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      codes: raw.codes && typeof raw.codes === 'object' ? raw.codes : {},
      tokens: raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {},
      devicePins: raw.devicePins && typeof raw.devicePins === 'object' ? raw.devicePins : {},
      claims: raw.claims && typeof raw.claims === 'object' ? raw.claims : {},
      requestAt: raw.requestAt && typeof raw.requestAt === 'object' ? raw.requestAt : {},
    };
  } catch {
    return { codes: {}, tokens: {}, devicePins: {}, claims: {}, requestAt: {} };
  }
}

function savePairingStore(store) {
  const file = pairingStorePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    const codes = {};
    for (const [k, v] of Object.entries(store.codes || {})) {
      if (v && v.expiresAt > now) codes[k] = v;
    }
    const tokens = {};
    for (const [k, v] of Object.entries(store.tokens || {})) {
      if (v && v.expiresAt > now) tokens[k] = v;
    }
    const devicePins = {};
    for (const [k, v] of Object.entries(store.devicePins || {})) {
      if (v && (!v.expiresAt || v.expiresAt > now)) devicePins[k] = v;
    }
    const claims = {};
    for (const [k, v] of Object.entries(store.claims || {})) {
      if (v && v.expiresAt > now) claims[k] = v;
    }
    const requestAt = {};
    for (const [k, v] of Object.entries(store.requestAt || {})) {
      if (Number(v) && now - Number(v) < 24 * 60 * 60 * 1000) requestAt[k] = v;
    }
    fs.writeFileSync(file, JSON.stringify({ codes, tokens, devicePins, claims, requestAt }, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[pairing] could not persist store:', err.message);
  }
}

function putPairingCode(code, entry) {
  const store = loadPairingStore();
  store.codes[String(code)] = entry;
  savePairingStore(store);
}

function takePairingCode(code) {
  const store = loadPairingStore();
  const key = String(code || '').trim();
  const entry = store.codes[key];
  if (!entry) return { error: 'not_found' };
  if (entry.expiresAt < Date.now()) {
    delete store.codes[key];
    savePairingStore(store);
    return { error: 'expired' };
  }
  delete store.codes[key];
  savePairingStore(store);
  return { entry };
}

function putBootstrapToken(token, entry) {
  const store = loadPairingStore();
  store.tokens[String(token)] = entry;
  savePairingStore(store);
}

let ownershipTransfer = null;
// Shape: {
//   targetDeviceId, targetDeviceName, status, initiatedAt, neonReady, error,
//   transferToken,  // short-lived secret required for export-db + complete
//   offline
// }

function requireActiveTransferToken(req) {
  if (!ownershipTransfer || !['pushing_to_neon', 'waiting_acceptance'].includes(ownershipTransfer.status)) {
    const err = new Error('No active ownership transfer in progress');
    err.status = 403;
    throw err;
  }
  const token = String(
    req.headers['x-transfer-token']
    || req.query?.transfer_token
    || req.body?.transfer_token
    || '',
  ).trim();
  const deviceId = String(
    req.headers['x-device-id']
    || req.body?.device_id
    || req.query?.device_id
    || '',
  ).trim();
  if (!token || !ownershipTransfer.transferToken
    || !timingSafeEqualStr(token, ownershipTransfer.transferToken)) {
    const err = new Error('Invalid or missing transfer authorization');
    err.status = 403;
    throw err;
  }
  if (!deviceId || deviceId !== ownershipTransfer.targetDeviceId) {
    const err = new Error('Transfer only allowed for the designated target device');
    err.status = 403;
    throw err;
  }
  return ownershipTransfer;
}

export async function createPairingCode(req, res, next) {
  try {
    if (!isBranchMode()) {
      return res.status(400).json({ detail: 'Pairing only on branch host' });
    }
    let shopId = branchConfig.shop_id;
    try {
      shopId = shopId || (await getDefaultShopId());
    } catch {
      return res.status(400).json({
        detail: 'Shop is not ready yet. Finish owner setup on this PC first, then generate a pairing code.',
      });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    putPairingCode(code, {
      shopId,
      expiresAt: Date.now() + PAIRING_TTL_MS,
      createdBy: req.user?.id,
    });
    return res.json({
      pairing_code: code,
      expires_in_seconds: Math.floor(PAIRING_TTL_MS / 1000),
      shop_id: shopId,
      hint: 'Enter this code on the joining PC within 30 minutes. Keep the owner app open.',
    });
  } catch (err) {
    next(err);
  }
}

const SHOP_JOIN_KEY = 'shop_join_code';

async function getShopJoinCodeRow(shopId) {
  const row = await Setting.findOne({ where: { key: SHOP_JOIN_KEY, shop_id: shopId } });
  if (row?.value?.code) return String(row.value.code);
  // Also allow unique key without shop filter (older rows)
  const any = await Setting.findOne({ where: { key: SHOP_JOIN_KEY } });
  return any?.value?.code ? String(any.value.code) : null;
}

async function setShopJoinCodeRow(shopId, code, userId) {
  const value = {
    code: String(code),
    updated_at: new Date().toISOString(),
    updated_by: userId || null,
  };
  let row = await Setting.findOne({ where: { key: SHOP_JOIN_KEY } });
  if (row) {
    await row.update({ value, shop_id: shopId || row.shop_id });
  } else {
    await Setting.create({
      id: newId(),
      key: SHOP_JOIN_KEY,
      shop_id: shopId,
      value,
    });
  }
  return value.code;
}

/** GET persistent 6-digit shop join code (owner Settings). */
export async function getShopJoinCode(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    let code = await getShopJoinCodeRow(shopId);
    if (!code) {
      code = String(Math.floor(100000 + Math.random() * 900000));
      await setShopJoinCodeRow(shopId, code, req.user?.id);
    }
    return res.json({ shop_join_code: code, shop_id: shopId });
  } catch (err) {
    next(err);
  }
}

/** PUT / regenerate persistent shop join code. Body: { code?: "123456" } */
export async function setShopJoinCode(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    let code = String(req.body?.code || '').trim();
    if (code) {
      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ detail: 'Shop code must be exactly 6 digits' });
      }
    } else {
      code = String(Math.floor(100000 + Math.random() * 900000));
    }
    await setShopJoinCodeRow(shopId, code, req.user?.id);
    return res.json({
      shop_join_code: code,
      shop_id: shopId,
      hint: 'Employees enter this code with their email on other PCs (same Wi‑Fi/LAN).',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Employee join + login on host.
 * Preferred: { email, pin, device_identifier, device_name } — PIN assigned by owner after LAN scan.
 * Legacy: { shop_code, email, password, device_identifier, device_name }
 */
export async function employeeJoin(req, res, next) {
  try {
    if (!isBranchMode()) {
      return res.status(400).json({ detail: 'Join only works against the shop host PC' });
    }
    const {
      shop_code: shopCode,
      pin,
      email,
      password,
      device_name: deviceName,
      device_identifier: deviceIdentifier,
    } = req.body || {};

    if (!email || !deviceIdentifier) {
      return res.status(400).json({ detail: 'email and device_identifier are required' });
    }

    const shopId = await getDefaultShopId();
    let device = await Device.findOne({
      where: { shop_id: shopId, device_identifier: String(deviceIdentifier).trim() },
    });

    // Primary path: Host-approved device + employee password (role from user)
    if (device && isDeviceApprovedStatus(device.status) && password) {
      const user = await User.findOne({ where: { email: String(email).toLowerCase().trim() } });
      if (!user || !user.active || !user.password_hash
          || !(await verifyPassword(password, user.password_hash))) {
        return res.status(401).json({ detail: 'Invalid email or password' });
      }
      await device.update({
        ...(deviceName ? { device_name: String(deviceName).trim() } : {}),
        last_seen_at: new Date(),
        status: 'active',
      });
      stopJoinReadyAdvertiser();
      let lanSharedKeyPw = null;
      try {
        const { ensureLanSharedSecret } = await import('../services/lanSecretService.js');
        lanSharedKeyPw = await ensureLanSharedSecret(shopId);
      } catch { /* */ }
      const tokenPw = createToken(user.id, user.email, {
        deviceId: device.device_identifier || device.id,
      });
      const { password_hash: _ph, ...userObjPw } = user.toJSON();
      userObjPw.permissions = normalizePermissionsObject(userObjPw.permissions);
      return res.json({
        access_token: tokenPw,
        token_type: 'bearer',
        user: userObjPw,
        shop_id: shopId,
        device: device.toJSON(),
        device_number: device.device_number,
        lan_shared_key: lanSharedKeyPw,
        joined_via: 'password',
      });
    }
    if (device && (device.status === 'pending' || device.status === 'declined')) {
      return res.status(403).json({
        detail: 'This computer needs approval from the Main PC before anyone can sign in.',
        code: device.status === 'declined' ? 'DEVICE_DECLINED' : 'DEVICE_PENDING',
      });
    }
    if (device && device.status === 'revoked') {
      return res.status(403).json({
        detail: 'This device is no longer authorized. Ask the owner to approve this computer again.',
        code: 'DEVICE_REVOKED',
      });
    }

    // Legacy code path retained for mid-upgrade clients (not shown in normal UX)
    const pinCode = String(pin || shopCode || '').trim();
    if (!/^\d{6}$/.test(pinCode)) {
      return res.status(403).json({
        detail: 'This computer is not approved yet. Wait for Main PC approval, then sign in with email and password.',
        code: 'DEVICE_PENDING',
      });
    }

    const store = loadPairingStore();
    let pinEntry = store.devicePins[String(deviceIdentifier)];
    if (!pinEntry || !timingSafeEqualStr(String(pinEntry.pin), pinCode)) {
      // Also allow matching by pin alone (owner assigned before device_id stabilized)
      pinEntry = Object.values(store.devicePins || {}).find(
        (e) => e && timingSafeEqualStr(String(e.pin), pinCode) && (!e.expiresAt || e.expiresAt > Date.now())
      );
    }
    let joinedVia = 'device_pin';
    let oneTimeCodeEntry = null;
    if (!pinEntry) {
      // Fallback: one-time pairing code (generated by owner via Settings → "One-time pairing code")
      const otcEntry = store.codes[pinCode];
      if (otcEntry && otcEntry.expiresAt > Date.now()) {
        oneTimeCodeEntry = otcEntry;
        joinedVia = 'one_time_code';
      }
    }
    if (!pinEntry && !oneTimeCodeEntry) {
      // Final fallback: persistent shop-wide join code (no password required — code is the authorization)
      const expected = await getShopJoinCodeRow(shopId);
      const expectedStr = String(expected || '').trim();
      if (!expectedStr || pinCode !== expectedStr) {
        return res.status(403).json({
          detail: `Invalid code. Got "${pinCode}", expected a 6-digit shop code from Settings → Devices on the owner PC.`,
        });
      }
      joinedVia = 'shop_code';
    }

    const user = await User.findOne({ where: { email: String(email).toLowerCase().trim() } });
    if (!user || !user.active) {
      return res.status(401).json({ detail: 'Unknown or inactive employee email. Ask the owner to add you under Employees first.' });
    }

    const name = (deviceName || pinEntry?.device_name || '').trim() || `PC-${String(deviceIdentifier).slice(0, 8)}`;
    if (device) {
      await device.update({
        device_name: name,
        status: 'active',
        last_seen_at: new Date(),
        role: device.role === 'active_host' ? 'active_host' : 'client',
      });
    } else {
      const maxRow = await Device.findOne({
        where: { shop_id: shopId },
        order: [['device_number', 'DESC']],
        attributes: ['device_number'],
      });
      const newDeviceNumber = Math.max((maxRow?.device_number || 1), 1) + 1;
      device = await Device.create({
        id: newId(),
        shop_id: shopId,
        device_name: name,
        device_identifier: deviceIdentifier,
        device_number: newDeviceNumber,
        role: 'client',
        status: 'active',
        last_seen_at: new Date(),
        meta: { joined_via: joinedVia },
      });
    }

    // Consume one-time device PIN after successful join
    if (pinEntry && store.devicePins) {
      for (const [k, v] of Object.entries(store.devicePins)) {
        if (v && timingSafeEqualStr(String(v.pin), pinCode)) delete store.devicePins[k];
      }
      savePairingStore(store);
    }
    // Consume one-time pairing code after successful join
    if (oneTimeCodeEntry) {
      const reloaded = loadPairingStore();
      delete reloaded.codes[pinCode];
      savePairingStore(reloaded);
    }

    stopJoinReadyAdvertiser();

    const bootstrapToken = crypto.randomBytes(24).toString('hex');
    putBootstrapToken(bootstrapToken, {
      shopId,
      deviceId: device.id,
      expiresAt: Date.now() + BOOTSTRAP_TTL_MS,
    });

    let lanSharedKey = null;
    try {
      const { ensureLanSharedSecret } = await import('../services/lanSecretService.js');
      lanSharedKey = await ensureLanSharedSecret(shopId);
    } catch { /* non-fatal for join */ }

    const token = createToken(user.id, user.email, {
      deviceId: device.device_identifier || device.id,
    });
    const { password_hash, ...userObj } = user.toJSON();
    userObj.permissions = normalizePermissionsObject(userObj.permissions);

    return res.json({
      access_token: token,
      token_type: 'bearer',
      user: userObj,
      shop_id: shopId,
      device: device.toJSON(),
      device_number: device.device_number,
      bootstrap_token: bootstrapToken,
      lan_shared_key: lanSharedKey,
      joined_via: joinedVia,
    });
  } catch (err) {
    next(err);
  }
}

/** Owner: scan LAN for PCs waiting to join. */
export async function listWaitingDevices(req, res, next) {
  try {
    const devices = await discoverJoinReadyDevices({
      timeoutMs: Number(req.query.timeout_ms) || 3500,
    });
    return res.json({ devices });
  } catch (err) {
    next(err);
  }
}

/**
 * Owner assigns a 6-digit PIN to a waiting PC.
 * Body: { device_identifier, device_name?, pin? }
 */
export async function assignDevicePin(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const deviceIdentifier = String(req.body?.device_identifier || '').trim();
    const deviceName = String(req.body?.device_name || '').trim() || 'Staff PC';
    let pin = String(req.body?.pin || '').trim();
    if (!deviceIdentifier) {
      return res.status(400).json({ detail: 'device_identifier required' });
    }
    if (pin) {
      if (!/^\d{6}$/.test(pin)) {
        return res.status(400).json({ detail: 'PIN must be exactly 6 digits' });
      }
    } else {
      pin = String(Math.floor(100000 + Math.random() * 900000));
    }
    const store = loadPairingStore();
    store.devicePins[deviceIdentifier] = {
      pin,
      shopId,
      device_name: deviceName,
      assigned_by: req.user?.id || null,
      assigned_at: new Date().toISOString(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h to complete first login
    };
    savePairingStore(store);
    return res.json({
      ok: true,
      pin,
      device_identifier: deviceIdentifier,
      device_name: deviceName,
      hint: 'On that PC, employee signs in with their email + this PIN (same Wi‑Fi).',
    });
  } catch (err) {
    next(err);
  }
}

/** Client PC: start advertising "waiting for owner PIN". */
export async function enableJoinReady(req, res) {
  const name = String(req.body?.device_name || '').trim() || undefined;
  // Keep advertising even on client/replica role so owner can scan this PC
  startJoinReadyAdvertiser({ deviceName: name });
  // Also ensure discovery socket is up if host advertiser was skipped
  try {
    const { startDiscoveryAdvertiser } = await import('../services/lanDiscovery.js');
    startDiscoveryAdvertiser();
  } catch { /* */ }
  return res.json({
    ok: true,
    join_ready: true,
    advertisement: buildAdvertisement(),
    device_id: branchConfig.device_id,
  });
}

export async function disableJoinReady(_req, res) {
  stopJoinReadyAdvertiser();
  return res.json({ ok: true, join_ready: false });
}

export async function listDevices(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const devices = await Device.findAll({
      where: { shop_id: shopId },
      order: [['created_at', 'ASC']],
    });
    return res.json(devices.map((d) => d.toJSON()));
  } catch (err) {
    next(err);
  }
}

export async function registerDevice(req, res, next) {
  try {
    const {
      pairing_code: pairingCode,
      device_name: deviceName,
      device_identifier: deviceIdentifier,
      role = 'client',
    } = req.body || {};

    if (!pairingCode || !deviceName || !deviceIdentifier) {
      return res.status(400).json({ detail: 'pairing_code, device_name, device_identifier required' });
    }

    const taken = takePairingCode(pairingCode);
    let entry = taken.entry;

    if (!entry) {
      // Also accept the persistent shop-wide join code (shown in Settings → Devices)
      const shopId2 = await getDefaultShopId();
      const shopJoinCode = await getShopJoinCodeRow(shopId2);
      if (shopJoinCode && timingSafeEqualStr(String(pairingCode).trim(), String(shopJoinCode).trim())) {
        entry = { shopId: shopId2 };
      } else if (taken.error === 'expired') {
        return res.status(403).json({
          detail: 'Code expired. Use the shop join code from Settings → Devices on the owner PC.',
        });
      } else {
        return res.status(403).json({
          detail: 'Invalid code. Use the 6-digit shop join code shown in Settings → Devices on the owner PC.',
        });
      }
    }

    const shopId = entry.shopId || (await getDefaultShopId());
    const existing = await Device.findOne({
      where: { shop_id: shopId, device_identifier: deviceIdentifier },
    });
    if (existing) {
      await existing.update({
        device_name: deviceName,
        status: 'active',
        last_seen_at: new Date(),
        role: existing.role === 'active_host' ? 'active_host' : (role === 'recovery' ? 'recovery' : 'client'),
      });
      const bootstrapToken = crypto.randomBytes(24).toString('hex');
      putBootstrapToken(bootstrapToken, {
        shopId,
        deviceId: existing.id,
        expiresAt: Date.now() + BOOTSTRAP_TTL_MS,
      });
      let lanSharedKey = null;
      try {
        const { ensureLanSharedSecret } = await import('../services/lanSecretService.js');
        lanSharedKey = await ensureLanSharedSecret(shopId);
      } catch { /* */ }
      return res.json({
        device: existing.toJSON(),
        shop_id: shopId,
        device_number: existing.device_number,
        rejoined: true,
        bootstrap_token: bootstrapToken,
        lan_shared_key: lanSharedKey,
      });
    }

    // Assign device_number: owner is 1, each new client gets max+1 (min 2)
    const maxRow = await Device.findOne({
      where: { shop_id: shopId },
      order: [['device_number', 'DESC']],
      attributes: ['device_number'],
    });
    const newDeviceNumber = Math.max((maxRow?.device_number || 1), 1) + 1;

    const safeRole = role === 'recovery' ? 'recovery' : 'client';
    const device = await Device.create({
      id: newId(),
      shop_id: shopId,
      device_name: deviceName,
      device_identifier: deviceIdentifier,
      device_number: newDeviceNumber,
      role: safeRole,
      status: 'active',
      last_seen_at: new Date(),
      meta: {},
    });
    const bootstrapToken = crypto.randomBytes(24).toString('hex');
    putBootstrapToken(bootstrapToken, {
      shopId,
      deviceId: device.id,
      expiresAt: Date.now() + BOOTSTRAP_TTL_MS,
    });
    let lanSharedKey = null;
    try {
      const { ensureLanSharedSecret } = await import('../services/lanSecretService.js');
      lanSharedKey = await ensureLanSharedSecret(shopId);
    } catch { /* */ }
    return res.status(201).json({
      device: device.toJSON(),
      shop_id: shopId,
      device_number: newDeviceNumber,
      api_advertisement: buildAdvertisement(),
      bootstrap_token: bootstrapToken,
      lan_shared_key: lanSharedKey,
      snapshot_hint: 'GET /api/cluster/snapshot/bootstrap?token=… within 15 minutes',
    });
  } catch (err) {
    next(err);
  }
}

export function consumeBootstrapToken(token) {
  const store = loadPairingStore();
  const key = String(token || '');
  const entry = store.tokens[key];
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) {
      delete store.tokens[key];
      savePairingStore(store);
    }
    return null;
  }
  delete store.tokens[key];
  savePairingStore(store);
  return entry;
}

export async function discoveryInfo(req, res) {
  if (isBranchMode()) {
    return res.json(buildAdvertisement());
  }
  return res.json({ magic: null, note: 'cloud mode — use branch host discovery' });
}

export async function discover(req, res, next) {
  try {
    const hosts = await discoverBranchHosts({ timeoutMs: Number(req.query.timeout_ms) || 3000 });
    return res.json({ hosts });
  } catch (err) {
    next(err);
  }
}

export async function heartbeat(req, res, next) {
  try {
    const deviceId = req.body?.device_id || req.headers['x-device-id'];
    if (!deviceId) return res.status(400).json({ detail: 'device_id required' });
    const { Op } = await import('sequelize');
    const device = await Device.findOne({
      where: {
        [Op.or]: [{ id: deviceId }, { device_identifier: deviceId }],
      },
    });
    if (!device) return res.status(404).json({ detail: 'Device not found' });
    if (device.status === 'revoked') {
      return res.status(403).json({
        ok: false,
        code: 'DEVICE_REVOKED',
        detail: 'This device has been removed from the shop. Pair again to continue.',
      });
    }
    if (!isDeviceApprovedStatus(device.status)) {
      return res.status(403).json({
        ok: false,
        code: device.status === 'declined' ? 'DEVICE_DECLINED' : 'DEVICE_PENDING',
        detail: 'This computer is not approved for shop access yet.',
      });
    }
    await device.update({ last_seen_at: new Date() });

    // Check if this device is the target of a pending ownership transfer
    const pendingAction =
      ownershipTransfer &&
      ownershipTransfer.status === 'waiting_acceptance' &&
      ownershipTransfer.targetDeviceId === device.id
        ? 'accept_ownership'
        : null;

    const transferMode = pendingAction ? (ownershipTransfer?.offline ? 'offline' : 'online') : null;
    // Only the designated target device receives the short-lived transfer token.
    const transferToken = pendingAction ? (ownershipTransfer?.transferToken || null) : null;
    if (ownershipTransfer?.expiresAt && ownershipTransfer.expiresAt < Date.now()) {
      ownershipTransfer = { status: 'failed', error: 'Transfer authorization expired' };
      return res.json({ ok: true, role: device.role, pending_action: null, transfer_mode: null });
    }
    return res.json({
      ok: true,
      role: device.role,
      pending_action: pendingAction,
      transfer_mode: transferMode,
      transfer_token: transferToken,
      target_device_id: pendingAction ? ownershipTransfer?.targetDeviceId : null,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/devices/transfer/:deviceId — Owner initiates transfer
export async function initiateOwnershipTransfer(req, res, next) {
  try {
    if (!isBranchMode()) return res.status(400).json({ detail: 'Only available on host PC' });
    if (ownershipTransfer && ownershipTransfer.status !== 'complete' && ownershipTransfer.status !== 'failed') {
      return res.status(409).json({ detail: 'A transfer is already in progress' });
    }
    const shopId = await getDefaultShopId();

    // Clean up any stale pending_owner devices from a crashed/expired previous transfer
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
    await Device.update(
      { role: 'client' },
      { where: { shop_id: shopId, role: 'pending_owner', updated_at: { [Op.lt]: staleThreshold } } },
    );

    const target = await Device.findOne({ where: { id: req.params.deviceId, shop_id: shopId } });
    if (!target) return res.status(404).json({ detail: 'Device not found' });
    if (target.role === 'active_host') return res.status(400).json({ detail: 'That PC is already the owner' });

    await target.update({ role: 'pending_owner' });

    const transferToken = crypto.randomBytes(32).toString('hex');
    ownershipTransfer = {
      targetDeviceId: target.id,
      targetDeviceName: target.device_name,
      status: 'pushing_to_neon',
      initiatedAt: new Date().toISOString(),
      neonReady: false,
      error: null,
      transferToken,
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    };
    // Never return the raw transfer token to the initiating UI over broad channels —
    // target device receives it only via authenticated heartbeat.
    return res.json({
      ok: true,
      transfer: {
        targetDeviceId: ownershipTransfer.targetDeviceId,
        targetDeviceName: ownershipTransfer.targetDeviceName,
        status: ownershipTransfer.status,
        initiatedAt: ownershipTransfer.initiatedAt,
      },
    });
  } catch (err) { next(err); }
}

// POST /api/devices/transfer/neon-ready — Owner marks LAN DB ready (legacy path name)
export async function markTransferNeonReady(req, res, next) {
  try {
    if (!ownershipTransfer) return res.status(400).json({ detail: 'No transfer in progress' });
    ownershipTransfer.neonReady = true;
    ownershipTransfer.status = 'waiting_acceptance';
    ownershipTransfer.offline = true; // local SQLite / LAN only — no cloud DB
    // Never expose transferToken to owner/admin via this channel — target gets it via heartbeat only.
    return res.json({
      ok: true,
      transfer: {
        targetDeviceId: ownershipTransfer.targetDeviceId,
        targetDeviceName: ownershipTransfer.targetDeviceName,
        status: ownershipTransfer.status,
        initiatedAt: ownershipTransfer.initiatedAt,
        neonReady: ownershipTransfer.neonReady,
        offline: ownershipTransfer.offline,
        error: ownershipTransfer.error || null,
      },
    });
  } catch (err) { next(err); }
}

// GET /api/devices/export-db — Stream SQLite only with transfer token + target device id
export async function exportDb(req, res, next) {
  try {
    requireActiveTransferToken(req);
    const dbPath = process.env.SQLITE_PATH;
    if (!dbPath || !fs.existsSync(dbPath)) {
      return res.status(500).json({ detail: 'Database path not available on this PC' });
    }

    // Checkpoint WAL so all pending writes are flushed into the main DB file
    try { await sequelize.query('PRAGMA wal_checkpoint(FULL)'); } catch { /* non-fatal */ }

    // Copy to a temp file — we stream the copy, not the live file
    const tmpPath = `${dbPath}.export-${Date.now()}.tmp`;
    fs.copyFileSync(dbPath, tmpPath);

    const stat = fs.statSync(tmpPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="jewellery-crm-transfer.sqlite"');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('X-Db-Size', String(stat.size));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Db-Size');

    const stream = fs.createReadStream(tmpPath);
    stream.on('close', () => { try { fs.unlinkSync(tmpPath); } catch {} });
    stream.on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      if (!res.headersSent) next(err);
    });
    stream.pipe(res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
}

// GET /api/devices/transfer-status — Owner/admin only (no transfer token leaked)
export function getOwnerTransferStatus(req, res) {
  if (!ownershipTransfer) return res.json({ status: 'idle' });
  return res.json({
    status: ownershipTransfer.status,
    targetDeviceId: ownershipTransfer.targetDeviceId,
    targetDeviceName: ownershipTransfer.targetDeviceName,
    initiatedAt: ownershipTransfer.initiatedAt,
    neonReady: ownershipTransfer.neonReady,
    error: ownershipTransfer.error || null,
    // never expose transferToken here
  });
}

// POST /api/devices/transfer/complete — Target PC only, with transfer token
export async function completeOwnershipTransfer(req, res, next) {
  try {
    requireActiveTransferToken(req);
    const { new_owner_url } = req.body || {};
    const shopId = await getDefaultShopId();
    const targetId = ownershipTransfer.targetDeviceId;
    // Promote target first, then demote self
    await Device.update({ role: 'active_host' }, { where: { id: targetId, shop_id: shopId } });
    await Device.update({ role: 'client' }, { where: { shop_id: shopId, role: 'active_host', id: { [Op.ne]: targetId } } });

    // Fence this node so it stops accepting writes and has a lower host_term
    // than the new host (which bumps term in ensureClusterState on startup).
    await fenceThisNode('Ownership transferred to device ' + targetId).catch(() => {});

    ownershipTransfer = {
      status: 'complete',
      targetDeviceId: targetId,
      newOwnerUrl: new_owner_url || null,
    };
    return res.json({ ok: true, new_owner_url });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
}

// POST /api/devices/transfer/cancel — Cancel in-progress transfer (settings.manage)
export async function cancelOwnershipTransfer(req, res, next) {
  try {
    if (ownershipTransfer && ownershipTransfer.targetDeviceId) {
      await Device.update({ role: 'client' }, { where: { id: ownershipTransfer.targetDeviceId, role: 'pending_owner' } });
    }
    ownershipTransfer = { status: 'failed', error: 'Cancelled by user' };
    return res.json({ ok: true });
  } catch (err) { next(err); }
}


// POST /api/devices/:id/revoke — Soft-revoke (keeps row; blocks API access)
export async function revokeDevice(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const device = await Device.findOne({ where: { id: req.params.id, shop_id: shopId } });
    if (!device) return res.status(404).json({ detail: 'Device not found' });
    if (device.role === 'active_host') {
      return res.status(400).json({ detail: 'Cannot revoke the active owner PC. Transfer ownership first.' });
    }
    const meta = { ...(device.meta || {}), revoked_at: new Date().toISOString(), revoked_by: req.user?.id || null };
    await device.update({ status: 'revoked', meta });
    return res.json({
      ok: true,
      detail: 'Device revoked',
      code: 'DEVICE_REVOKED',
      device: device.toJSON(),
    });
  } catch (err) {
    next(err);
  }
}

/** Authenticated device pulls shop LAN HMAC secret (no public exposure). */
export async function getLanCredential(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const deviceHeader = String(req.headers['x-device-id'] || req.query.device_id || '').trim();
    if (!deviceHeader) {
      return res.status(400).json({ detail: 'X-Device-Id header required' });
    }
    const { Op } = await import('sequelize');
    const device = await Device.findOne({
      where: {
        shop_id: shopId,
        status: { [Op.in]: ['active', 'approved'] },
        [Op.or]: [{ id: deviceHeader }, { device_identifier: deviceHeader }],
      },
    });
    if (!device) {
      return res.status(403).json({ detail: 'Device not registered, pending approval, or revoked' });
    }
    const { ensureLanSharedSecret, lanSecretFingerprint } = await import('../services/lanSecretService.js');
    const secret = await ensureLanSharedSecret(shopId);
    return res.json({
      lan_shared_key: secret,
      fingerprint: lanSecretFingerprint(secret),
      shop_id: shopId,
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/devices/:id — Remove a stale/unwanted client device
export async function deleteDevice(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const device = await Device.findOne({ where: { id: req.params.id, shop_id: shopId } });
    if (!device) return res.status(404).json({ detail: 'Device not found' });
    if (device.role === 'active_host') {
      return res.status(400).json({ detail: 'Cannot delete the active owner PC. Transfer ownership first.' });
    }
    await device.destroy();
    return res.json({ ok: true, detail: 'Device removed' });
  } catch (err) { next(err); }
}

