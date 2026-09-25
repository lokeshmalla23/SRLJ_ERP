import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  createSession,
  getSessionById,
  getSummary,
  getStock,
  getManualVerification,
  getHistory,
  getCategorySummary,
  postScan,
  postReset,
} from '../controllers/barcodeStockCheck.js';

const router = Router();

router.get('/category-summary', authenticate, requirePermission('barcode_stock_check', 'view'), getCategorySummary);
router.post('/sessions', authenticate, requirePermission('barcode_stock_check', 'view'), createSession);
router.get('/sessions/:id', authenticate, requirePermission('barcode_stock_check', 'view'), getSessionById);
router.get('/sessions/:id/summary', authenticate, requirePermission('barcode_stock_check', 'view'), getSummary);
router.get('/sessions/:id/stock', authenticate, requirePermission('barcode_stock_check', 'view'), getStock);
router.get('/sessions/:id/manual-verification', authenticate, requirePermission('barcode_stock_check', 'view'), getManualVerification);
router.get('/sessions/:id/history', authenticate, requirePermission('barcode_stock_check', 'view'), getHistory);
router.post('/sessions/:id/scan', authenticate, requirePermission('barcode_stock_check', 'manage'), postScan);
router.post('/sessions/:id/reset', authenticate, requirePermission('barcode_stock_check', 'manage'), postReset);

export default router;
