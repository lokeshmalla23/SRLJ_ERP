import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getPurchaseSummary,
  listPurchases,
  getPurchase,
  createPurchase,
  updatePurchase,
  addPurchasePayment,
  deletePurchase,
} from '../controllers/purchases.js';

const router = Router();

// GET /api/purchases/summary
router.get('/summary', authenticate, requirePermission('purchases', 'view'), getPurchaseSummary);

// GET /api/purchases
router.get('/', authenticate, requirePermission('purchases', 'view'), listPurchases);

// GET /api/purchases/:id
router.get('/:id', authenticate, requirePermission('purchases', 'view'), getPurchase);

// POST /api/purchases
router.post('/', authenticate, requirePermission('purchases', 'create'), createPurchase);

// PUT /api/purchases/:id
router.put('/:id', authenticate, requirePermission('purchases', 'edit'), updatePurchase);

// POST /api/purchases/:id/payment
router.post('/:id/payment', authenticate, requirePermission('purchases', 'edit'), addPurchasePayment);

// DELETE /api/purchases/:id
router.delete('/:id', authenticate, requirePermission('purchases', 'delete'), deletePurchase);

export default router;
