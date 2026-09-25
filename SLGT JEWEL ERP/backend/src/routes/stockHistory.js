import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listStockHistory,
  getStockHistoryRecord,
  listAdjustments,
  createAdjustment,
  listMovements,
} from '../controllers/stockHistory.js';

const router = Router();

router.get('/history', authenticate, requirePermission('stock', 'view'), listStockHistory);
router.get('/history/:id', authenticate, requirePermission('stock', 'view'), getStockHistoryRecord);
router.get('/adjustments', authenticate, requirePermission('stock', 'view'), listAdjustments);
router.post('/adjustments', authenticate, requirePermission('stock', 'create'), createAdjustment);
router.get('/movements', authenticate, requirePermission('stock', 'view'), listMovements);

export default router;
