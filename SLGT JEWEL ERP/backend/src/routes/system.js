import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { createLocalBackup, endOfDayReport } from '../services/backupService.js';
import { SCHEMA_VERSION } from '../config/schemaVersion.js';
import branchConfig from '../config/branchConfig.js';
import { APP_MODE } from '../config/appMode.js';
import { printBase64ImageOnHost, printRawBytesOnHost } from '../services/windowsPrintService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

router.get('/eod', authenticate, requirePermission('reports', 'view'), async (req, res, next) => {
  try {
    const report = await endOfDayReport(req.query.date ? new Date(req.query.date) : new Date());
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post('/backup', authenticate, requirePermission('backup', 'manage'), async (req, res, next) => {
  try {
    const result = await createLocalBackup();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/diagnostics', authenticate, requirePermission('settings', 'view'), async (req, res) => {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  let appVersion = null;
  try { appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version; } catch { /* */ }
  res.json({
    app_version: appVersion,
    schema_version: SCHEMA_VERSION,
    app_mode: APP_MODE,
    device_id: branchConfig.device_id,
    device_name: branchConfig.device_name,
    role: branchConfig.role,
    shop_id: branchConfig.shop_id,
    // sanitized — no secrets
  });
});

/**
 * Print a rendered invoice/report image on THIS machine's local printer.
 * Used by client (replica) PCs so Canon CAPT receives the job on the host USB
 * instead of a broken \\HOST\Canon network redirect.
 *
 * Only meaningful when this process runs on the main/host PC (clients POST here
 * via the host LAN API URL).
 */
router.post('/print-image', authenticate, requireAnyPermission(['pos', 'view'], ['reports', 'view'], ['settings', 'view']), async (req, res) => {
  try {
    if (process.platform !== 'win32') {
      return res.status(400).json({ detail: 'Host printing is only supported on Windows' });
    }
    const { image_base64, mime_type, preferred_printer, paper_size, page_width_in, page_height_in, fill_page, paper_kind } = req.body || {};
    const result = await printBase64ImageOnHost({
      imageBase64: image_base64,
      mimeType: mime_type,
      preferredPrinter: preferred_printer,
      paperSizeName: paper_size,
      pageWidthIn: page_width_in,
      pageHeightIn: page_height_in,
      fillPaper: Boolean(fill_page),
      paperKind: Number(paper_kind) || 0,
    });
    return res.json(result);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      detail: err.message || 'Print failed',
      code: err.code || 'print_failed',
      success: false,
    });
  }
});

/**
 * Print raw printer bytes (TSPL label bitmap / ESC-POS thermal receipt) on
 * THIS machine's local printer — the raw-byte counterpart to /print-image,
 * for client PCs relaying a barcode/estimation job to the host's printer.
 */
router.post('/print-raw', authenticate, requireAnyPermission(['pos', 'view'], ['reports', 'view'], ['settings', 'view']), async (req, res) => {
  try {
    if (process.platform !== 'win32') {
      return res.status(400).json({ detail: 'Host printing is only supported on Windows' });
    }
    const { bytes_base64, preferred_printer } = req.body || {};
    const result = await printRawBytesOnHost({
      bytesBase64: bytes_base64,
      preferredPrinter: preferred_printer,
    });
    return res.json(result);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      detail: err.message || 'Print failed',
      code: err.code || 'print_failed',
      success: false,
    });
  }
});

export default router;
