/**
 * Device authorization (Host approval) — separate from employee authentication.
 * A PC on the LAN must request access; Host Allow issues credentials via claim store.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import { Device, Shop } from '../models/index.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { isBranchMode } from '../config/appMode.js';
import { startJoinReadyAdvertiser, stopJoinReadyAdvertiser } from '../services/lanDiscovery.js';

// Pairing store helpers mirror devices.js (same file path) so claims live
// alongside bootstrap tokens issued by legacy register/employee-join.

const CLAIM_TTL_MS = 30 * 60 * 1000;
const BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;

export function isDeviceApprovedStatus(status) {
  return status === 'active' || status === 'approved';
}

async function findShopDevice(shopId, identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  return Device.findOne({
    where: {
      shop_id: shopId,
      [Op.or]: [{ device_identifier: id }, { id }],
    },
  });
}

function pairingStorePath() {
  if (process.env.SQLITE_PATH) {
    return path.join(path.dirname(process.env.SQLITE_PATH), 'pairing-codes.json');
  }
  if (process.env.ELECTRON_USERDATA) {
    return path.join(process.env.ELECTRON_USERDATA, 'data', 'pairing-codes.json');
  }
  return path.join(process.cwd(), 'pairing-codes.json');
}

function loadStore() {
  const file = pairingStorePath();
  try {
    if (!fs.existsSync(file)) {
      return { codes: {}, tokens: {}, devicePins: {}, claims: {}, requestAt: {} };
    }
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

function saveStore(store) {
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
    fs.writeFileSync(
      file,
      JSON.stringify({ codes, tokens, devicePins, claims, requestAt }, null, 2),
      { mode: 0o600 },
    );
  } catch (err) {
    console.warn('[deviceAuthorization] could not persist store:', err.message);
  }
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function putBootstrapToken(token, entry) {
  const store = loadStore();
  store.tokens[String(token)] = entry;
  saveStore(store);
}

async function issueClaim(device, shopId) {
  const deviceToken = crypto.randomBytes(32).toString('hex');
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
  } catch { /* non-fatal */ }

  const store = loadStore();
  store.claims[String(device.device_identifier)] = {
    shopId,
    deviceId: device.id,
    device_token: deviceToken,
    bootstrap_token: bootstrapToken,
    lan_shared_key: lanSharedKey,
    expiresAt: Date.now() + CLAIM_TTL_MS,
  };
  saveStore(store);

  const meta = {
    ...(device.meta || {}),
    device_token_hash: hashDeviceToken(deviceToken),
    approved_at: new Date().toISOString(),
  };
  await device.update({
    status: 'active',
    role: device.role === 'active_host' ? 'active_host' : 'client',
    meta,
    last_seen_at: new Date(),
  });
  return { deviceToken, bootstrapToken, lanSharedKey };
}

async function shopLabel(shopId) {
  try {
    const shop = await Shop.findByPk(shopId);
    return shop?.name || null;
  } catch {
    return null;
  }
}

/** POST /devices/request-join */
export async function requestJoin(req, res, next) {
  try {
    if (!isBranchMode()) {
      return res.status(400).json({ detail: 'Access requests only work against the Main PC' });
    }
    const deviceIdentifier = String(req.body?.device_identifier || '').trim();
    const deviceName = String(req.body?.device_name || '').trim()
      || `PC-${deviceIdentifier.slice(0, 8) || 'unknown'}`;
    const platform = String(req.body?.platform || '').trim() || null;
    const clientAddress = String(
      req.body?.network_address
      || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || '',
    ).replace(/^::ffff:/, '') || null;

    if (!deviceIdentifier) {
      return res.status(400).json({ detail: 'device_identifier is required' });
    }

    const shopId = await getDefaultShopId();
    const store = loadStore();
    const lastAt = Number(store.requestAt?.[deviceIdentifier] || 0);
    if (lastAt && Date.now() - lastAt < REQUEST_COOLDOWN_MS) {
      const waitSec = Math.ceil((REQUEST_COOLDOWN_MS - (Date.now() - lastAt)) / 1000);
      return res.status(429).json({
        detail: `Please wait ${waitSec}s before requesting access again.`,
        code: 'REQUEST_RATE_LIMITED',
        retry_after_seconds: waitSec,
      });
    }

    let device = await findShopDevice(shopId, deviceIdentifier);

    if (device && device.status === 'revoked') {
      const meta = {
        ...(device.meta || {}),
        platform,
        network_address: clientAddress,
        requested_at: new Date().toISOString(),
        re_request_after_revoke: true,
      };
      delete meta.device_token_hash;
      delete meta.approved_at;
      await device.update({
        device_name: deviceName || device.device_name,
        status: 'pending',
        role: 'client',
        last_seen_at: new Date(),
        meta,
      });
    } else if (device && isDeviceApprovedStatus(device.status)) {
      store.requestAt[deviceIdentifier] = Date.now();
      saveStore(store);
      return res.json({
        ok: true,
        status: 'active',
        already_approved: true,
        shop_id: shopId,
        shop_name: await shopLabel(shopId),
        device_number: device.device_number,
        device: {
          id: device.id,
          device_name: device.device_name,
          device_identifier: device.device_identifier,
        },
      });
    } else if (device) {
      const meta = {
        ...(device.meta || {}),
        platform,
        network_address: clientAddress,
        requested_at: new Date().toISOString(),
      };
      await device.update({
        device_name: deviceName || device.device_name,
        status: 'pending',
        last_seen_at: new Date(),
        meta,
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
        device_name: deviceName,
        device_identifier: deviceIdentifier,
        device_number: newDeviceNumber,
        role: 'client',
        status: 'pending',
        last_seen_at: new Date(),
        meta: {
          platform,
          network_address: clientAddress,
          requested_at: new Date().toISOString(),
          joined_via: 'access_request',
        },
      });
    }

    store.requestAt[deviceIdentifier] = Date.now();
    saveStore(store);
    startJoinReadyAdvertiser({ deviceName: device.device_name });

    return res.status(201).json({
      ok: true,
      status: 'pending',
      shop_id: shopId,
      shop_name: await shopLabel(shopId),
      device: {
        id: device.id,
        device_name: device.device_name,
        device_identifier: device.device_identifier,
        status: 'pending',
      },
      message: 'Waiting for approval from the Main PC.',
    });
  } catch (err) {
    next(err);
  }
}

/** GET /devices/join-status?device_identifier= */
export async function getJoinStatus(req, res, next) {
  try {
    if (!isBranchMode()) {
      return res.status(400).json({ detail: 'Join status only on Main PC' });
    }
    const deviceIdentifier = String(req.query?.device_identifier || '').trim();
    if (!deviceIdentifier) {
      return res.status(400).json({ detail: 'device_identifier required' });
    }
    const shopId = await getDefaultShopId();
    const device = await findShopDevice(shopId, deviceIdentifier);
    const shopName = await shopLabel(shopId);

    if (!device) {
      return res.json({
        status: 'unknown',
        shop_id: shopId,
        shop_name: shopName,
        claim_ready: false,
      });
    }

    const store = loadStore();
    const claim = store.claims?.[device.device_identifier] || store.claims?.[deviceIdentifier];
    const claimReady = Boolean(
      isDeviceApprovedStatus(device.status)
      && claim
      && claim.expiresAt > Date.now()
      && claim.device_token,
    );

    return res.json({
      status: device.status === 'approved' ? 'active' : device.status,
      shop_id: shopId,
      shop_name: shopName,
      device_name: device.device_name,
      device_id: device.id,
      claim_ready: claimReady,
      revoked: device.status === 'revoked',
      declined: device.status === 'declined',
    });
  } catch (err) {
    next(err);
  }
}

/** POST /devices/claim-approval */
export async function claimApproval(req, res, next) {
  try {
    if (!isBranchMode()) {
      return res.status(400).json({ detail: 'Claim only against Main PC' });
    }
    const deviceIdentifier = String(req.body?.device_identifier || '').trim();
    if (!deviceIdentifier) {
      return res.status(400).json({ detail: 'device_identifier required' });
    }
    const shopId = await getDefaultShopId();
    const device = await findShopDevice(shopId, deviceIdentifier);
    if (!device) {
      return res.status(404).json({ detail: 'Device not found', code: 'DEVICE_NOT_FOUND' });
    }
    if (device.status === 'revoked') {
      return res.status(403).json({
        detail: 'This device is no longer authorized.',
        code: 'DEVICE_REVOKED',
      });
    }
    if (device.status === 'declined') {
      return res.status(403).json({
        detail: 'Access request declined.',
        code: 'DEVICE_DECLINED',
      });
    }
    if (!isDeviceApprovedStatus(device.status)) {
      return res.status(403).json({
        detail: 'This computer is still waiting for approval.',
        code: 'DEVICE_PENDING',
      });
    }

    const store = loadStore();
    const claim = store.claims?.[device.device_identifier] || store.claims?.[deviceIdentifier];
    if (!claim || claim.expiresAt < Date.now() || !claim.device_token) {
      return res.status(409).json({
        detail: 'Approval credential already claimed or expired.',
        code: 'CLAIM_UNAVAILABLE',
        status: device.status,
        shop_id: shopId,
      });
    }

    delete store.claims[device.device_identifier];
    delete store.claims[deviceIdentifier];
    saveStore(store);
    stopJoinReadyAdvertiser();

    return res.json({
      ok: true,
      shop_id: shopId,
      device: device.toJSON(),
      device_number: device.device_number,
      device_token: claim.device_token,
      bootstrap_token: claim.bootstrap_token || null,
      lan_shared_key: claim.lan_shared_key || null,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /devices/:id/approve */
export async function approveDevice(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const device = await Device.findOne({ where: { id: req.params.id, shop_id: shopId } });
    if (!device) return res.status(404).json({ detail: 'Device not found' });
    if (device.role === 'active_host') {
      return res.status(400).json({ detail: 'Main PC does not need approval' });
    }
    if (device.status === 'revoked') {
      return res.status(400).json({ detail: 'Revoked devices must request access again first' });
    }

    await issueClaim(device, shopId);
    await device.reload();
    return res.json({
      ok: true,
      device: device.toJSON(),
      hint: 'Client will receive credentials and can open employee login.',
    });
  } catch (err) {
    next(err);
  }
}

/** POST /devices/:id/decline */
export async function declineDevice(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const device = await Device.findOne({ where: { id: req.params.id, shop_id: shopId } });
    if (!device) return res.status(404).json({ detail: 'Device not found' });
    if (device.role === 'active_host') {
      return res.status(400).json({ detail: 'Cannot decline the Main PC' });
    }
    const meta = {
      ...(device.meta || {}),
      declined_at: new Date().toISOString(),
      declined_by: req.user?.id || null,
    };
    delete meta.device_token_hash;
    const store = loadStore();
    if (store.claims) delete store.claims[device.device_identifier];
    saveStore(store);
    await device.update({ status: 'declined', meta });
    return res.json({ ok: true, device: device.toJSON() });
  } catch (err) {
    next(err);
  }
}

/** PATCH /devices/:id — rename */
export async function renameDevice(req, res, next) {
  try {
    const shopId = await getDefaultShopId();
    const name = String(req.body?.device_name || '').trim();
    if (!name) return res.status(400).json({ detail: 'device_name required' });
    const device = await Device.findOne({ where: { id: req.params.id, shop_id: shopId } });
    if (!device) return res.status(404).json({ detail: 'Device not found' });
    await device.update({ device_name: name });
    return res.json({ ok: true, device: device.toJSON() });
  } catch (err) {
    next(err);
  }
}
