import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listCustomerAdvances,
  getBalance,
  createAdvance,
  applyAdvance,
} from '../controllers/advances.js';

const router = Router();

router.get('/', authenticate, requirePermission('customers', 'view'), listCustomerAdvances);
router.get('/balance/:customerId', authenticate, requireAnyPermission(['pos', 'view'], ['customers', 'view']), getBalance);
router.post('/', authenticate, requirePermission('pos', 'create'), createAdvance);
router.post('/apply', authenticate, requirePermission('pos', 'create'), applyAdvance);

export default router;
