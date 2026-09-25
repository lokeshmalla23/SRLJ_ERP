import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listSettings,
  getCompanySetting,
  getPublicCompanyBranding,
  updateCompanySetting,
  getLoginMusicSetting,
  updateLoginMusicSetting,
  getStockAlertSoundSetting,
  updateStockAlertSoundSetting,
  getGoldRate,
  updateGoldRate,
  syncGoldRate,
  testMetalSources,
  getInvoiceSettings,
  updateInvoiceSettings,
  getBarcodeTagSettings,
  updateBarcodeTagSettings,
  getEstimationPrintSettings,
  updateEstimationPrintSettings,
  getOfflineSettings,
  updateOfflineSettings,
  listCounters,
  saveCounters,
  getHiddenBillSettings,
  updateHiddenBillSettings,
  verifyHiddenBillPassword,
  revealHiddenBillPassword,
  unlockCompanyProfile,
  unlockPrintSettings,
  updateOwnerCredentials,
  getApplicationFeatures,
  updateApplicationFeatures,
  unlockApplicationManagement,
  getSectionVisibility,
  updateSectionVisibility,
  getOldMetalExchangeManualMode,
  updateOldMetalExchangeManualMode,
  getProfitLossSetting,
  updateProfitLossSetting,
  getCalCodeSetting,
  updateCalCodeSetting,
} from '../controllers/settings.js';

const router = Router();

// Public branding for login (name + logo only)
router.get('/company/public', getPublicCompanyBranding);

// GET /api/settings
router.get('/', authenticate, listSettings);

// GET /api/settings/company — POS also needs this for invoice header
router.get('/company', authenticate, requireAnyPermission(['pos', 'view'], ['settings', 'view']), getCompanySetting);

// PUT /api/settings/company
router.put('/company', authenticate, requirePermission('settings', 'manage'), updateCompanySetting);

router.post(
  '/company/unlock',
  authenticate,
  requirePermission('settings', 'manage'),
  unlockCompanyProfile,
);

// POST /api/settings/print-settings/unlock — shared lock for Printers & Devices,
// Invoice Print, Barcode Tag and Estimation Print tabs.
router.post(
  '/print-settings/unlock',
  authenticate,
  requirePermission('settings', 'manage'),
  unlockPrintSettings,
);

// POST /api/settings/application-management/unlock — same password as the
// company profile lock (see updateApplicationFeatures for the owner-role check).
router.post(
  '/application-management/unlock',
  authenticate,
  requirePermission('settings', 'manage'),
  unlockApplicationManagement,
);

// Login-screen background music — separate settings row so its (larger) data
// URL never rides along with the authenticated /settings/company fetch used
// app-wide by CompanyContext.
router.get('/login-music', authenticate, requireAnyPermission(['settings', 'view'], ['settings', 'manage']), getLoginMusicSetting);
router.put('/login-music', authenticate, requirePermission('settings', 'manage'), updateLoginMusicSetting);

// Stock-limit alert sound — plays in POS/Estimation. Any authenticated user
// with POS/estimation access can fetch it (they're the ones who'll hear it);
// only settings.manage can change it.
router.get('/stock-alert-sound', authenticate, requireAnyPermission(['pos', 'view'], ['settings', 'view'], ['settings', 'manage']), getStockAlertSoundSetting);
router.put('/stock-alert-sound', authenticate, requirePermission('settings', 'manage'), updateStockAlertSoundSetting);

// POST /api/settings/company/metal-sources/test — dry-run the configured Metal Price Sources
router.post(
  '/company/metal-sources/test',
  authenticate,
  requirePermission('settings', 'manage'),
  testMetalSources,
);

// PUT /api/settings/owner-credentials — create/update the owner login (Company Profile → Update Password)
router.put(
  '/owner-credentials',
  authenticate,
  requirePermission('settings', 'manage'),
  updateOwnerCredentials,
);

// GET /api/settings/gold-rate
router.get('/gold-rate', authenticate, getGoldRate);

// PUT /api/settings/gold-rate
router.put('/gold-rate', authenticate, requirePermission('settings', 'edit'), updateGoldRate);

// POST /api/settings/gold-rate/sync — fetch live rates from DP Gold immediately
router.post('/gold-rate/sync', authenticate, requirePermission('settings', 'edit'), syncGoldRate);

router.get('/invoice', authenticate, getInvoiceSettings);
router.put('/invoice', authenticate, requirePermission('settings', 'manage'), updateInvoiceSettings);

router.get('/barcode-tag', authenticate, getBarcodeTagSettings);
router.put('/barcode-tag', authenticate, requirePermission('settings', 'manage'), updateBarcodeTagSettings);

router.get('/estimation-print', authenticate, getEstimationPrintSettings);
router.put('/estimation-print', authenticate, requirePermission('settings', 'manage'), updateEstimationPrintSettings);

router.get('/offline', authenticate, getOfflineSettings);
router.put('/offline', authenticate, requirePermission('settings', 'manage'), updateOfflineSettings);

router.get(
  '/counters',
  authenticate,
  requireAnyPermission(['settings', 'view'], ['catalog', 'view'], ['inventory', 'view'], ['pos', 'view'], ['reports', 'view']),
  listCounters,
);
router.put(
  '/counters',
  authenticate,
  requireAnyPermission(['settings', 'manage'], ['catalog', 'manage'], ['catalog', 'create'], ['catalog', 'edit']),
  saveCounters,
);

router.get('/hidden-bill', authenticate, getHiddenBillSettings);
router.put('/hidden-bill', authenticate, updateHiddenBillSettings);
router.post('/verify-hidden-bill-password', authenticate, verifyHiddenBillPassword);
router.get('/hidden-bill/reveal', authenticate, revealHiddenBillPassword);

// Application Management (shop-level module licensing) — GET is any authenticated
// user (sidebar/route guards need it), PUT is owner-only (checked inside the handler).
router.get('/application-management', authenticate, getApplicationFeatures);
router.put('/application-management', authenticate, updateApplicationFeatures);

// Section-level visibility within Reports & Analytics / Accounts & Finance —
// same GET-any-user / PUT-owner-checked-inside-handler shape as above.
router.get('/section-visibility', authenticate, getSectionVisibility);
router.put('/section-visibility', authenticate, updateSectionVisibility);

// Old Gold / Old Silver Exchange manual-mode toggle — same GET-any-user /
// PUT-owner-checked-inside-handler shape as Application Management above.
router.get('/old-metal-exchange', authenticate, getOldMetalExchangeManualMode);
router.put('/old-metal-exchange', authenticate, updateOldMetalExchangeManualMode);

// Profit & Loss (mandatory purchase price on new products) — same shape.
router.get('/profit-loss', authenticate, getProfitLossSetting);
router.put('/profit-loss', authenticate, updateProfitLossSetting);

// Cal Code (optional product field) — same shape.
router.get('/cal-code', authenticate, getCalCodeSetting);
router.put('/cal-code', authenticate, updateCalCodeSetting);

router.post('/verify-manager-pin', authenticate, async (req, res, next) => {
  const { verifyManagerPin } = await import('../middleware/managerOverride.js');
  return verifyManagerPin(req, res, next);
});

export default router;
