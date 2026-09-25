import { Setting, ShopCounter, GoldRateHistory, Shop, User } from '../models/index.js';
import sequelize from '../db.js';
import { newId, nowIso, hashPassword } from '../utils.js';
import { Op } from 'sequelize';
import { DEFAULT_GST_PCT, VALID_PAYMENT_MODES } from '../services/billingCalc.js';
import branchConfig from '../config/branchConfig.js';
import { defaultPermissionsForRole, resolveApplicationFeatures, APPLICATION_FEATURE_KEYS } from '../constants.js';
import { normalizePermissionsObject } from '../permissions.js';
import { RESERVED_ADMIN_EMAIL, isReservedAdminEmail } from '../services/permanentAdmin.js';
import { applyMetalRateSync, testMetalSources as testMetalSourcesService } from '../services/metalRateSyncService.js';
import { normalizeMetalPriceSources, hasAnySourceConfigured } from '../services/metalSourceResolver.js';
import { assertValidSourceUrlFormat } from '../utils/urlSafety.js';
import { asObject, upsertSetting } from '../services/settingsStore.js';
import { appendAuditEvent } from '../services/auditTrailService.js';
import { appendEventLog } from '../services/eventLogService.js';
import { OLD_METAL_MANUAL_SETTING_KEY, resolveOldMetalManualMode } from '../services/oldMetalManualMode.js';
import { PROFIT_LOSS_SETTING_KEY } from '../services/profitLossMode.js';

const DEFAULT_GOLD_RATE_SETTINGS = {
  gold_22k: 0,
  gold_18k: 0,
  gold_24k: 0,
  silver: 0,
  pure_silver: 0,
  platinum: 0,
  live_rate_enabled: false,
  live_rate_last_synced_at: null,
  live_rate_last_error: null,
};

const DEFAULT_INVOICE_SETTINGS = {
  gst_pct: Number(DEFAULT_GST_PCT) || 3,
  payment_modes: [...VALID_PAYMENT_MODES],
  default_making_charge_type: 'fixed',
  default_wastage_pct: 0,
  manager_override_pin: null,
  max_discount_pct_without_override: 10,
  // On: every date shown in Accounts/Reports/Statements includes the real
  // clock time next to the transaction date. Off: date only, everywhere —
  // see frontend/src/lib/format.js's fmtDateTime().
  show_transaction_time: true,
  whatsapp_pdf_folder: '',
  invoice_pdf_folder: '',
};

const LETTERHEAD_PAPER_SIZES = ['A4', 'A5', 'A6'];
const LETTERHEAD_MAX_BYTES = 5 * 1024 * 1024;
const LETTERHEAD_DATA_URL = /^data:(image\/(?:png|jpeg|jpg|webp));base64,/i;

function normalizeLetterheadPaperSize(raw) {
  const id = String(raw || '').trim().toUpperCase();
  return LETTERHEAD_PAPER_SIZES.includes(id) ? id : 'A5';
}

function coalesceLetterheadDest(explicit, legacyEnabled) {
  if (explicit === true || explicit === false) return explicit;
  if (explicit === 'true' || explicit === 1 || explicit === '1') return true;
  if (explicit === 'false' || explicit === 0 || explicit === '0') return false;
  return Boolean(legacyEnabled);
}

function assertLetterheadValid(normalized) {
  const usesLetterhead = Boolean(normalized.invoice_letterhead_on_print || normalized.invoice_letterhead_on_download);
  if (!usesLetterhead) return;
  const image = normalized.invoice_letterhead_image;
  if (!image) {
    const err = new Error('Upload a letterhead image in Company before turning it on for print or download');
    err.status = 400;
    throw err;
  }
  if (!LETTERHEAD_DATA_URL.test(image)) {
    const err = new Error('Letterhead must be a PNG, JPG, or WebP image');
    err.status = 400;
    throw err;
  }
  const b64 = String(image.split(',')[1] || '');
  const bytes = Math.floor(b64.length * 0.75);
  if (bytes > LETTERHEAD_MAX_BYTES) {
    const err = new Error('Letterhead image must be 5 MB or smaller');
    err.status = 400;
    throw err;
  }
}

/** Normalize UI + legacy seed keys so name/logo/GST/prefix/address are consistent. */
export function normalizeCompanyValue(raw = {}) {
  const v = asObject(raw);
  const gst = String(v.gst_number || v.gstin || '').trim();
  const prefix = String(v.invoice_prefix || v.prefix || '').trim().toUpperCase();
  const logo = v.logo || v.logo_url || '';
  const ownerName = String(v.owner_name || v.shop_owner_name || '').trim();
  const letterheadImage = typeof v.invoice_letterhead_image === 'string' ? v.invoice_letterhead_image : '';
  return {
    ...v,
    name: String(v.name || '').trim(),
    owner_name: ownerName,
    shop_owner_name: ownerName,
    tagline: String(v.tagline || '').trim(),
    phone: String(v.phone || '').trim(),
    email: String(v.email || '').trim(),
    address: String(v.address || '').trim(),
    gst_number: gst,
    gstin: gst,
    invoice_prefix: prefix,
    prefix,
    logo,
    logo_url: logo,
    whatsapp_number: String(v.whatsapp_number || '').trim(),
    profile_locked: Boolean(v.profile_locked),
    // Defaults to ON (opt-out, not opt-in) — this mirrors the always-on
    // behavior POS billing already had before this toggle existed, so
    // existing shops that haven't touched this field keep the same
    // Aadhaar-above-₹50,000 requirement rather than silently losing it.
    aadhaar_mandatory_above_50000: v.aadhaar_mandatory_above_50000 !== false,
    invoice_letterhead_on_print: coalesceLetterheadDest(v.invoice_letterhead_on_print, v.invoice_letterhead_enabled),
    invoice_letterhead_on_download: coalesceLetterheadDest(v.invoice_letterhead_on_download, v.invoice_letterhead_enabled),
    invoice_letterhead_enabled: coalesceLetterheadDest(v.invoice_letterhead_on_print, v.invoice_letterhead_enabled)
      || coalesceLetterheadDest(v.invoice_letterhead_on_download, v.invoice_letterhead_enabled),
    invoice_letterhead_paper_size: normalizeLetterheadPaperSize(v.invoice_letterhead_paper_size),
    invoice_letterhead_image: letterheadImage,
    invoice_letterhead_file_name: String(v.invoice_letterhead_file_name || '').trim(),
    invoice_letterhead_file_size: Number(v.invoice_letterhead_file_size) || 0,
    invoice_letterhead_width_px: Number(v.invoice_letterhead_width_px) || 0,
    invoice_letterhead_height_px: Number(v.invoice_letterhead_height_px) || 0,
    // Undefined (never configured) is preserved as-is so the sync service can tell
    // "never set up" apart from "explicitly cleared" — see metalRateSyncService.js.
    ...(v.metal_price_sources != null ? { metal_price_sources: normalizeMetalPriceSources(v.metal_price_sources) } : {}),
  };
}

/** Throws a 400 error if any configured metal price source URL is malformed or unsafe. */
function assertMetalPriceSourcesValid(sources) {
  if (!sources) return;
  for (const [slot, url] of Object.entries(sources)) {
    if (!url) continue;
    try {
      assertValidSourceUrlFormat(url);
    } catch (err) {
      const e = new Error(`Metal Price Sources — ${slot.replace('_', ' ')}: ${err.message}`);
      e.status = 400;
      throw e;
    }
  }
}

async function syncShopFromCompany(normalized, shopId, t) {
  let shop = null;
  if (shopId) {
    shop = await Shop.findByPk(shopId, { transaction: t });
  }
  if (!shop) {
    shop = await Shop.findOne({
      where: { status: 'active' },
      order: [['created_at', 'ASC']],
      transaction: t,
    });
  }
  if (!shop) return;
  const patch = {};
  if (normalized.name) patch.name = normalized.name;
  if (normalized.invoice_prefix) patch.invoice_prefix = normalized.invoice_prefix;
  if (normalized.gst_number) patch.gstin = normalized.gst_number;
  if (normalized.phone) patch.phone = normalized.phone;
  if (normalized.email) patch.email = normalized.email;
  if (normalized.address) patch.address = normalized.address;
  if (Object.keys(patch).length) {
    await shop.update(patch, { transaction: t });
  }
}

// GET /api/settings
export const listSettings = async (req, res, next) => {
  try {
    const settings = await Setting.findAll();
    return res.json(settings.map((s) => ({
      key: s.key,
      value: s.key === 'company' ? normalizeCompanyValue(s.value) : asObject(s.value),
    })));
  } catch (err) {
    next(err);
  }
};

// GET /api/settings/company
export const getCompanySetting = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'company' } });
    return res.json(normalizeCompanyValue(setting?.value));
  } catch (err) {
    next(err);
  }
};

/** Public branding for login screen — name/logo/tagline/music only (no GST/phone/etc). */
export const getPublicCompanyBranding = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'company' } });
    const c = normalizeCompanyValue(setting?.value);
    // login_music lives in its own setting row (not `company`) so the large
    // audio data URL never gets pulled into every authenticated page's
    // company-context fetch — only this public login-branding call needs it.
    const musicSetting = await Setting.findOne({ where: { key: 'login_music' } });
    const music = asObject(musicSetting?.value);
    return res.json({
      name: c.name || '',
      tagline: c.tagline || '',
      logo: c.logo || '',
      login_music: music.data || '',
      login_music_loop: Boolean(music.loop),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/settings/login-music — current upload, for the Settings page to display
export const getLoginMusicSetting = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'login_music' } });
    const value = asObject(setting?.value);
    return res.json({ login_music: value.data || '', login_music_loop: Boolean(value.loop) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/login-music — { login_music: "data:audio/...;base64,..." (or "" to clear), login_music_loop?: boolean }
export const updateLoginMusicSetting = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const existing = await Setting.findOne({ where: { key: 'login_music' }, transaction: t });
    const prev = asObject(existing?.value);
    // Either field may be sent alone (e.g. flipping the loop toggle without
    // re-uploading audio) — merge onto whatever is already stored.
    const data = typeof req.body?.login_music === 'string' ? req.body.login_music : (prev.data || '');
    const loop = req.body?.login_music_loop != null ? Boolean(req.body.login_music_loop) : Boolean(prev.loop);
    // Stored inline in a settings row (like the logo) — cap it so a long/uncompressed
    // upload can't bloat that row indefinitely.
    if (data.length > 8 * 1024 * 1024) {
      await t.rollback();
      return res.status(400).json({ detail: 'Audio file is too large — keep it under ~6MB.' });
    }
    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('login_music', { data, loop }, shopId, t);
    await t.commit();
    return res.json({ login_music: value.data || '', login_music_loop: Boolean(value.loop) });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/settings/stock-alert-sound — plays in POS/Estimation when a duplicate
// add would exceed the item's available stock (e.g. only 1 in stock, already on the bill).
export const getStockAlertSoundSetting = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'stock_alert_sound' } });
    return res.json({ stock_alert_sound: asObject(setting?.value).data || '' });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/stock-alert-sound — { stock_alert_sound: "data:audio/...;base64,..." } or "" to clear
export const updateStockAlertSoundSetting = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const data = typeof req.body?.stock_alert_sound === 'string' ? req.body.stock_alert_sound : '';
    if (data.length > 8 * 1024 * 1024) {
      await t.rollback();
      return res.status(400).json({ detail: 'Audio file is too large — keep it under ~6MB.' });
    }
    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('stock_alert_sound', { data }, shopId, t);
    await t.commit();
    return res.json({ stock_alert_sound: value.data || '' });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/settings/company
export const updateCompanySetting = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = req.user?.shop_id || null;
    let setting = await Setting.findOne({ where: { key: 'company' }, transaction: t });
    const merged = normalizeCompanyValue({
      ...(setting ? asObject(setting.value) : {}),
      ...(req.body || {}),
      profile_locked: true,
    });
    assertLetterheadValid(merged);
    assertMetalPriceSourcesValid(merged.metal_price_sources);
    if (setting) {
      await setting.update({ value: merged }, { transaction: t });
    } else {
      setting = await Setting.create({
        id: newId(),
        key: 'company',
        shop_id: shopId,
        value: merged,
      }, { transaction: t });
    }
    await syncShopFromCompany(merged, shopId, t);
    if (merged.owner_name) {
      await User.update(
        { name: merged.owner_name },
        {
          where: {
            role: { [Op.in]: ['shop_owner', 'owner'] },
            email: { [Op.ne]: RESERVED_ADMIN_EMAIL },
            ...(shopId ? { shop_id: shopId } : {}),
          },
          transaction: t,
        },
      );
    }
    await t.commit();
    return res.json(normalizeCompanyValue(setting.value));
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/settings/gold-rate
export const getGoldRate = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'gold_rate' } });
    return res.json({ ...DEFAULT_GOLD_RATE_SETTINGS, ...asObject(setting?.value) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/gold-rate
export const updateGoldRate = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    if (req.body?.live_rate_enabled) {
      const companySetting = await Setting.findOne({ where: { key: 'company' }, transaction: t });
      const companyValue = asObject(companySetting?.value);
      // `metal_price_sources == null` means this install predates the source-config
      // feature — metalRateSyncService self-heals it to the legacy DP Gold feed on
      // first sync, so don't block the toggle here.
      const isLegacyUnconfigured = companyValue.metal_price_sources == null;
      const sources = normalizeMetalPriceSources(companyValue.metal_price_sources);
      if (!isLegacyUnconfigured && !hasAnySourceConfigured(sources)) {
        const err = new Error('No metal price source configured — set at least one URL in Settings → Company → Company Profile → Metal Price Sources before enabling live rates.');
        err.status = 400;
        throw err;
      }
    }
    const shopId = req.user?.shop_id || null;
    const body = { ...(req.body || {}) };
    const sourceIn = String(body.source || '').toLowerCase().trim();
    delete body.source;
    const source = sourceIn === 'dashboard' ? 'dashboard' : 'settings';
    const value = await upsertSetting('gold_rate', { ...body, updated_at: nowIso() }, shopId, t);
    await GoldRateHistory.create({
      id: newId(),
      shop_id: shopId,
      rates: value,
      changed_by: req.user?.id || null,
      source,
      origin_device_id: branchConfig.device_id || null,
    }, { transaction: t });
    await t.commit();
    return res.json(value);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// POST /api/settings/gold-rate/sync — fetch live rates from the configured source(s) immediately
// (used by the "Sync now" button and right after the live-rate toggle is switched on).
export const syncGoldRate = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id || null;
    const { value, error } = await applyMetalRateSync({ shopId, changedBy: req.user?.id || null, source: 'live_manual' });
    if (error === 'No metal price source configured') {
      return res.status(400).json({ detail: value?.live_rate_last_error || error, ...value });
    }
    if (error) return res.status(502).json({ detail: `Live rate sync failed: ${error}`, ...value });
    return res.json(value);
  } catch (err) {
    next(err);
  }
};

// POST /api/settings/company/metal-sources/test — dry-run test of configured (or draft) Metal
// Price Sources. Never touches the saved gold_rate/history — purely a diagnostic.
export const testMetalSources = async (req, res, next) => {
  try {
    let sources = req.body && typeof req.body === 'object' ? req.body : null;
    if (!sources || !Object.keys(sources).length) {
      const setting = await Setting.findOne({ where: { key: 'company' } });
      sources = asObject(setting?.value).metal_price_sources;
    }
    sources = normalizeMetalPriceSources(sources);
    if (!hasAnySourceConfigured(sources)) {
      const err = new Error('No metal price source configured to test.');
      err.status = 400;
      throw err;
    }
    assertMetalPriceSourcesValid(sources);
    const report = await testMetalSourcesService(sources);
    return res.json(report);
  } catch (err) {
    next(err);
  }
};

// GET /api/settings/invoice
export const getInvoiceSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'invoice' } });
    const value = { ...DEFAULT_INVOICE_SETTINGS, ...asObject(setting?.value) };
    if (!Array.isArray(value.payment_modes) || value.payment_modes.length === 0) {
      value.payment_modes = [...VALID_PAYMENT_MODES];
    } else {
      value.payment_modes = value.payment_modes
        .map((m) => String(m).trim().toLowerCase())
        .filter((m) => VALID_PAYMENT_MODES.includes(m));
      if (!value.payment_modes.length) value.payment_modes = [...VALID_PAYMENT_MODES];
    }
    if (value.gst_pct == null || Number.isNaN(Number(value.gst_pct))) {
      value.gst_pct = Number(DEFAULT_GST_PCT) || 3;
    }
    return res.json(value);
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/invoice
export const updateInvoiceSettings = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = req.user?.shop_id || null;
    const body = { ...req.body };
    if (body.gst_pct != null) body.gst_pct = Number(body.gst_pct);
    if (body.payment_modes) {
      const modes = Array.isArray(body.payment_modes)
        ? body.payment_modes.map((m) => String(m).trim().toLowerCase()).filter(Boolean)
        : String(body.payment_modes).split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);
      const allowed = modes.filter((m) => VALID_PAYMENT_MODES.includes(m));
      body.payment_modes = allowed.length ? allowed : [...VALID_PAYMENT_MODES];
    }
    if (body.show_transaction_time != null) {
      body.show_transaction_time = body.show_transaction_time !== false && body.show_transaction_time !== 'false';
    }
    if (body.whatsapp_pdf_folder != null) {
      body.whatsapp_pdf_folder = String(body.whatsapp_pdf_folder).trim().slice(0, 500);
    }
    if (body.invoice_pdf_folder != null) {
      body.invoice_pdf_folder = String(body.invoice_pdf_folder).trim().slice(0, 500);
    }
    const value = await upsertSetting('invoice', body, shopId, t);
    await t.commit();
    return res.json({ ...DEFAULT_INVOICE_SETTINGS, ...value });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/settings/barcode-tag
export const getBarcodeTagSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'barcode_tag' } });
    return res.json(asObject(setting?.value));
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/barcode-tag
export const updateBarcodeTagSettings = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('barcode_tag', req.body, shopId, t);
    await t.commit();
    return res.json(value);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/settings/estimation-print
export const getEstimationPrintSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'estimation_print' } });
    return res.json(asObject(setting?.value));
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/estimation-print
export const updateEstimationPrintSettings = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('estimation_print', req.body, shopId, t);
    await t.commit();
    return res.json(value);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/settings/counters
export const listCounters = async (req, res, next) => {
  try {
    const rows = await ShopCounter.findAll({ order: [['name', 'ASC']] });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/settings/offline
export const getOfflineSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'offline' } });
    const value = asObject(setting?.value);
    return res.json({ pricing_mode: 'preserve', ...value });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/offline
export const updateOfflineSettings = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('offline', req.body, shopId, t);
    await t.commit();
    return res.json({ pricing_mode: 'preserve', ...value });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/settings/counters — replace list (config-first for 1-shop)
export const saveCounters = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = req.user?.shop_id || null;
    const incoming = Array.isArray(req.body?.counters) ? req.body.counters : [];
    const existing = await ShopCounter.findAll({ transaction: t });
    const keepIds = new Set(incoming.filter((c) => c.id).map((c) => c.id));
    for (const row of existing) {
      if (!keepIds.has(row.id)) await row.destroy({ transaction: t });
    }
    const saved = [];
    for (const c of incoming) {
      const payload = {
        name: String(c.name || '').trim() || 'Counter',
        code: c.code || null,
        device_id: c.device_id || null,
        is_default: Boolean(c.is_default),
        status: c.status || 'active',
        shop_id: shopId,
      };
      if (c.id) {
        const row = await ShopCounter.findByPk(c.id, { transaction: t });
        if (row) {
          await row.update(payload, { transaction: t });
          saved.push(row);
          continue;
        }
      }
      saved.push(await ShopCounter.create({ id: newId(), ...payload }, { transaction: t }));
    }
    await t.commit();
    return res.json({ data: saved });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/settings/hidden-bill — owner only; never returns the raw password
export const getHiddenBillSettings = async (req, res, next) => {
  try {
    const role = String(req.user?.role || '');
    if (role !== 'shop_owner' && role !== 'owner' && role !== 'super_admin') {
      return res.status(403).json({ detail: 'Owner only' });
    }
    const setting = await Setting.findOne({ where: { key: 'hidden_bill' } });
    const value = asObject(setting?.value);
    return res.json({
      configured: Boolean(value.password),
      updated_at: value.updated_at || null,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/settings/hidden-bill/reveal — ERP Administrator (super_admin) only.
// Deliberately stricter than getHiddenBillSettings above: a normal shop_owner
// can change this password but never read it back — only the reserved
// administrator login can, for support recovery calls.
export const revealHiddenBillPassword = async (req, res, next) => {
  try {
    const role = String(req.user?.role || '');
    if (role !== 'super_admin') {
      return res.status(403).json({ detail: 'ERP Administrator only' });
    }
    const setting = await Setting.findOne({ where: { key: 'hidden_bill' } });
    const value = asObject(setting?.value);
    return res.json({
      configured: Boolean(value.password),
      password: value.password || null,
      updated_at: value.updated_at || null,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/hidden-bill — set/change password (owner only)
export const updateHiddenBillSettings = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '');
    if (role !== 'shop_owner' && role !== 'owner' && role !== 'super_admin') {
      await t.rollback();
      return res.status(403).json({ detail: 'Owner only' });
    }
    const password = String(req.body?.password ?? '').trim();
    if (!/^\d{4,8}$/.test(password)) {
      await t.rollback();
      return res.status(400).json({ detail: 'Password must be 4–8 digits' });
    }
    const existing = await Setting.findOne({ where: { key: 'hidden_bill' }, transaction: t });
    const currentStored = String(asObject(existing?.value).password || '');
    if (currentStored) {
      const currentPassword = String(req.body?.current_password ?? '').trim();
      if (currentPassword !== currentStored) {
        await t.rollback();
        return res.status(403).json({
          detail: 'Failed — current password does not match',
          ok: false,
          code: 'WRONG_HIDDEN_BILL_PIN',
        });
      }
    }
    const shopId = req.user?.shop_id || null;
    await upsertSetting('hidden_bill', { password, updated_at: nowIso() }, shopId, t);
    await t.commit();
    return res.json({ configured: true, updated: Boolean(currentStored) });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// POST /api/settings/verify-hidden-bill-password — any authenticated POS user
export const verifyHiddenBillPassword = async (req, res, next) => {
  try {
    const password = String(req.body?.password ?? '').trim();
    const setting = await Setting.findOne({ where: { key: 'hidden_bill' } });
    const value = asObject(setting?.value);
    if (!value.password) {
      return res.status(400).json({
        detail: 'Hidden bill password is not set. Ask the owner to set it in Settings.',
      });
    }
    if (password !== String(value.password)) {
      // 403 — authenticated user, wrong secret (must NOT be 401 or client logs them out)
      return res.status(403).json({ detail: 'Incorrect password', ok: false, code: 'WRONG_HIDDEN_BILL_PIN' });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// ─── Application Management (shop-level module licensing) ───────────────────
// Separate from RBAC: controls whether a module exists for this shop at all,
// independent of any user's permissions within it. See constants.js for the
// feature registry and default-enabled resolution.

// GET /api/settings/application-management — any authenticated user (the
// sidebar/route guard needs this for every user, not just the owner).
export const getApplicationFeatures = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'application_features' } });
    return res.json({ features: resolveApplicationFeatures(asObject(setting?.value)) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/application-management — ERP Administrator (super_admin) only.
// Body: { features: { key: bool, ... } }
export const updateApplicationFeatures = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '');
    if (role !== 'super_admin') {
      await t.rollback();
      return res.status(403).json({ detail: 'ERP Administrator only' });
    }
    const incoming = req.body?.features;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      await t.rollback();
      return res.status(400).json({ detail: 'features object is required' });
    }

    const existing = await Setting.findOne({ where: { key: 'application_features' }, transaction: t });
    const before = resolveApplicationFeatures(asObject(existing?.value));

    const changes = [];
    const patch = {};
    for (const key of APPLICATION_FEATURE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
      const next = Boolean(incoming[key]);
      if (next === before[key]) continue;
      patch[key] = next;
      changes.push({ key, from: before[key], to: next });
    }

    if (changes.length === 0) {
      await t.commit();
      return res.json({ features: before });
    }

    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('application_features', patch, shopId, t);
    const setting = existing || await Setting.findOne({ where: { key: 'application_features' }, transaction: t });

    for (const change of changes) {
      await appendAuditEvent({
        eventType: 'application_management',
        action: change.to ? 'enabled' : 'disabled',
        entityType: 'application_feature',
        entityId: change.key,
        userId: req.user?.id || null,
        deviceId: req.deviceId || null,
        oldValue: change.from,
        newValue: change.to,
        transaction: t,
      });
    }

    await appendEventLog({
      eventType: 'SETTING_UPSERTED',
      entityType: 'setting',
      entityId: setting?.id,
      payload: { setting: { id: setting?.id, key: 'application_features', value, shop_id: shopId } },
      originDeviceId: req.deviceId || null,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.json({ features: resolveApplicationFeatures(value) });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── Section-level visibility (Reports & Analytics / Accounts & Finance) ────
// Finer-grained sibling of Application Management above — toggles individual
// categories/sub-items within the Reports and Accounts modules rather than
// the whole module. UI-only enforcement (hides nav/tabs); no backend route
// gating, so no catalog needs to be duplicated here — any well-formed key is
// accepted and stored as-is, and the frontend catalogs (reportCatalog.js,
// accountsShared.js) stay the single source of truth for which keys exist.
const SECTION_VISIBILITY_KEY_RE = /^(reports|accounts):(category|item):[a-z0-9-]+$/;

// GET /api/settings/section-visibility — any authenticated user.
export const getSectionVisibility = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'section_visibility' } });
    return res.json({ sections: asObject(setting?.value) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/section-visibility — ERP Administrator (super_admin) only.
// Body: { sections: { "<module>:<category|item>:<id>": bool, ... } }
export const updateSectionVisibility = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '');
    if (role !== 'super_admin') {
      await t.rollback();
      return res.status(403).json({ detail: 'ERP Administrator only' });
    }
    const incoming = req.body?.sections;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      await t.rollback();
      return res.status(400).json({ detail: 'sections object is required' });
    }

    const existing = await Setting.findOne({ where: { key: 'section_visibility' }, transaction: t });
    const before = asObject(existing?.value);

    const changes = [];
    const patch = {};
    for (const key of Object.keys(incoming)) {
      if (!SECTION_VISIBILITY_KEY_RE.test(key)) continue;
      const next = Boolean(incoming[key]);
      const prevVisible = before[key] !== false;
      if (next === prevVisible) continue;
      patch[key] = next;
      changes.push({ key, from: prevVisible, to: next });
    }

    if (changes.length === 0) {
      await t.commit();
      return res.json({ sections: before });
    }

    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting('section_visibility', patch, shopId, t);
    const setting = existing || await Setting.findOne({ where: { key: 'section_visibility' }, transaction: t });

    for (const change of changes) {
      await appendAuditEvent({
        eventType: 'application_management',
        action: change.to ? 'shown' : 'hidden',
        entityType: 'section_visibility',
        entityId: change.key,
        userId: req.user?.id || null,
        deviceId: req.deviceId || null,
        oldValue: change.from,
        newValue: change.to,
        transaction: t,
      });
    }

    await appendEventLog({
      eventType: 'SETTING_UPSERTED',
      entityType: 'setting',
      entityId: setting?.id,
      payload: { setting: { id: setting?.id, key: 'section_visibility', value, shop_id: shopId } },
      originDeviceId: req.deviceId || null,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.json({ sections: value });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── Old Gold / Old Silver Exchange — Manual Mode ───────────────────────────
// Another sibling of Application Management above: per-metal switch between
// the existing automatic weight × rate calculation (OFF, default — unchanged
// behavior) and manual entry, where the cashier types the exchange amount
// directly (billingService.js re-reads this same setting server-side, never
// trusting a client-sent flag).
const OLD_METAL_KEYS = ['gold', 'silver'];

// GET /api/settings/old-metal-exchange — any authenticated user.
export const getOldMetalExchangeManualMode = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ where: { key: OLD_METAL_MANUAL_SETTING_KEY } });
    return res.json({ manual: resolveOldMetalManualMode(setting?.value) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/old-metal-exchange — ERP Administrator (super_admin) only.
// Body: { manual: { gold: bool, silver: bool } }
export const updateOldMetalExchangeManualMode = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '');
    if (role !== 'super_admin') {
      await t.rollback();
      return res.status(403).json({ detail: 'ERP Administrator only' });
    }
    const incoming = req.body?.manual;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      await t.rollback();
      return res.status(400).json({ detail: 'manual object is required' });
    }

    const existing = await Setting.findOne({ where: { key: OLD_METAL_MANUAL_SETTING_KEY }, transaction: t });
    const before = resolveOldMetalManualMode(existing?.value);

    const changes = [];
    const patch = {};
    for (const metal of OLD_METAL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(incoming, metal)) continue;
      const next = Boolean(incoming[metal]);
      if (next === before[metal]) continue;
      patch[metal] = next;
      changes.push({ metal, from: before[metal], to: next });
    }

    if (changes.length === 0) {
      await t.commit();
      return res.json({ manual: before });
    }

    const shopId = req.user?.shop_id || null;
    const value = await upsertSetting(OLD_METAL_MANUAL_SETTING_KEY, patch, shopId, t);
    const setting = existing || await Setting.findOne({ where: { key: OLD_METAL_MANUAL_SETTING_KEY }, transaction: t });

    for (const change of changes) {
      await appendAuditEvent({
        eventType: 'application_management',
        action: change.to ? 'enabled' : 'disabled',
        entityType: 'old_metal_exchange_manual',
        entityId: change.metal,
        userId: req.user?.id || null,
        deviceId: req.deviceId || null,
        oldValue: change.from,
        newValue: change.to,
        transaction: t,
      });
    }

    await appendEventLog({
      eventType: 'SETTING_UPSERTED',
      entityType: 'setting',
      entityId: setting?.id,
      payload: { setting: { id: setting?.id, key: OLD_METAL_MANUAL_SETTING_KEY, value, shop_id: shopId } },
      originDeviceId: req.deviceId || null,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.json({ manual: resolveOldMetalManualMode(value) });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── On/off admin flags (Profit & Loss, Cal Code) ───────────────────────────
// Same shape as the Old Metal manual-mode toggle above: stored as
// { enabled: bool } under one settings key, GET for any authenticated user,
// PUT for the ERP Administrator (super_admin) only, every change audited.
function adminFlagHandlers({ key, entityType, entityId }) {
  const resolve = (stored) => ({ enabled: asObject(stored).enabled === true });

  const get = async (req, res, next) => {
    try {
      const setting = await Setting.findOne({ where: { key } });
      return res.json(resolve(setting?.value));
    } catch (err) {
      next(err);
    }
  };

  // Body: { enabled: bool }
  const update = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const role = String(req.user?.role || '');
      if (role !== 'super_admin') {
        await t.rollback();
        return res.status(403).json({ detail: 'ERP Administrator only' });
      }
      if (typeof req.body?.enabled !== 'boolean') {
        await t.rollback();
        return res.status(400).json({ detail: 'enabled (boolean) is required' });
      }

      const existing = await Setting.findOne({ where: { key }, transaction: t });
      const before = resolve(existing?.value);
      const nextEnabled = req.body.enabled;

      if (nextEnabled === before.enabled) {
        await t.commit();
        return res.json(before);
      }

      const shopId = req.user?.shop_id || null;
      const value = await upsertSetting(key, { enabled: nextEnabled }, shopId, t);
      const setting = existing || await Setting.findOne({ where: { key }, transaction: t });

      await appendAuditEvent({
        eventType: 'application_management',
        action: nextEnabled ? 'enabled' : 'disabled',
        entityType,
        entityId,
        userId: req.user?.id || null,
        deviceId: req.deviceId || null,
        oldValue: before.enabled,
        newValue: nextEnabled,
        transaction: t,
      });

      await appendEventLog({
        eventType: 'SETTING_UPSERTED',
        entityType: 'setting',
        entityId: setting?.id,
        payload: { setting: { id: setting?.id, key, value, shop_id: shopId } },
        originDeviceId: req.deviceId || null,
        userId: req.user?.id || null,
        transaction: t,
      });

      await t.commit();
      return res.json(resolve(value));
    } catch (err) {
      await t.rollback();
      next(err);
    }
  };

  return { get, update };
}

// Profit & Loss: when ON, the product form requires a purchase price and
// createProduct rejects a product without one (re-read server-side).
const profitLossFlag = adminFlagHandlers({
  key: PROFIT_LOSS_SETTING_KEY,
  entityType: 'profit_loss',
  entityId: 'purchase_price_required',
});
// GET/PUT /api/settings/profit-loss
export const getProfitLossSetting = profitLossFlag.get;
export const updateProfitLossSetting = profitLossFlag.update;

// Cal Code: when ON, the product form shows an optional Cal Code field.
// Printing it on the barcode tag is a separate Barcode Tag layout option.
const calCodeFlag = adminFlagHandlers({
  key: 'cal_code',
  entityType: 'cal_code',
  entityId: 'cal_code_field',
});
// GET/PUT /api/settings/cal-code
export const getCalCodeSetting = calCodeFlag.get;
export const updateCalCodeSetting = calCodeFlag.update;

// POST /api/settings/print-settings/unlock — owner / settings.manage; unlocks one
// Printers & Devices / Invoice Print / Barcode Tag / Estimation Print tab
// (same password as the company profile lock). The client keeps each tab's
// lock independent.
export const unlockPrintSettings = async (req, res, next) => {
  try {
    const password = String(req.body?.password ?? '');
    if (password !== COMPANY_PROFILE_UNLOCK) {
      return res.status(403).json({
        detail: 'Failed — incorrect password',
        ok: false,
        code: 'WRONG_PRINT_SETTINGS_UNLOCK',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/settings/application-management/unlock — same password as the
// company profile lock, ERP Administrator (super_admin) only — matches the
// role check in updateApplicationFeatures so unlocking is never granted to a
// caller whose subsequent writes would just be rejected anyway.
export const unlockApplicationManagement = async (req, res, next) => {
  try {
    const role = String(req.user?.role || '');
    if (role !== 'super_admin') {
      return res.status(403).json({ detail: 'ERP Administrator only' });
    }
    const password = String(req.body?.password ?? '');
    if (password !== COMPANY_PROFILE_UNLOCK) {
      return res.status(403).json({
        detail: 'Failed — incorrect password',
        ok: false,
        code: 'WRONG_APP_MANAGEMENT_UNLOCK',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings/owner-credentials — owner/administrator only.
// Creates or updates the single owner login. Independent of the permanent
// administrator account (SLGT@ERP), which this never reads/modifies.
export const updateOwnerCredentials = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const role = String(req.user?.role || '');
    if (role !== 'shop_owner' && role !== 'owner' && role !== 'super_admin') {
      await t.rollback();
      return res.status(403).json({ detail: 'Owner only' });
    }

    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const confirmPassword = String(req.body?.confirm_password ?? req.body?.confirmPassword ?? '');

    if (!username) {
      await t.rollback();
      return res.status(400).json({ detail: 'Username is required' });
    }
    if (!password || password.length < 6) {
      await t.rollback();
      return res.status(400).json({ detail: 'Password must be at least 6 characters' });
    }
    if (password !== confirmPassword) {
      await t.rollback();
      return res.status(400).json({ detail: 'Passwords do not match' });
    }

    const usernameNorm = username.toLowerCase();
    if (isReservedAdminEmail(usernameNorm)) {
      await t.rollback();
      return res.status(400).json({ detail: 'This username is reserved. Choose a different username.' });
    }

    const existingOwner = await User.findOne({
      where: { role: { [Op.in]: ['shop_owner', 'owner'] }, email: { [Op.ne]: RESERVED_ADMIN_EMAIL } },
      order: [['created_at', 'ASC']],
      transaction: t,
    });

    const conflict = await User.findOne({
      where: {
        email: usernameNorm,
        ...(existingOwner ? { id: { [Op.ne]: existingOwner.id } } : {}),
      },
      transaction: t,
    });
    if (conflict) {
      await t.rollback();
      return res.status(409).json({ detail: 'Username already in use' });
    }

    const passwordHash = await hashPassword(password);

    if (existingOwner) {
      await existingOwner.update(
        { email: usernameNorm, password_hash: passwordHash, active: true },
        { transaction: t },
      );
    } else {
      // Inherit the display name already set on Company Profile — otherwise this
      // login is born with a permanent generic "Shop Owner" name that the
      // Company Profile sync (which only touches existing rows) can never reach.
      const companySetting = await Setting.findOne({ where: { key: 'company' }, transaction: t });
      const ownerName = String(asObject(companySetting?.value).owner_name || '').trim();
      await User.create({
        id: newId(),
        shop_id: req.user?.shop_id || null,
        email: usernameNorm,
        name: ownerName || 'Shop Owner',
        password_hash: passwordHash,
        role: 'shop_owner',
        permissions: normalizePermissionsObject(defaultPermissionsForRole('shop_owner')),
        active: true,
      }, { transaction: t });
    }

    await t.commit();
    return res.json({ ok: true, username: usernameNorm });
  } catch (err) {
    await t.rollback().catch(() => {});
    next(err);
  }
};

const COMPANY_PROFILE_UNLOCK = 'SLGT@1821';

// POST /api/settings/company/unlock — owner / settings.manage; unlocks frozen company profile
export const unlockCompanyProfile = async (req, res, next) => {
  try {
    const password = String(req.body?.password ?? '');
    if (password !== COMPANY_PROFILE_UNLOCK) {
      return res.status(403).json({
        detail: 'Failed — incorrect password',
        ok: false,
        code: 'WRONG_COMPANY_UNLOCK',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
