import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listHsn,
  upsertHsn,
  productStatusHistory,
  listAccounts,
  listJournals,
  listOldGold,
} from '../controllers/mastersExtra.js';

const router = Router();

router.get('/hsn', authenticate, listHsn);
router.put('/hsn', authenticate, requirePermission('settings', 'manage'), upsertHsn);
router.get('/products/:productId/status-history', authenticate, requirePermission('inventory', 'view'), productStatusHistory);
router.get('/coa', authenticate, requirePermission('accounts', 'view'), listAccounts);
router.get('/journals', authenticate, requirePermission('accounts', 'view'), listJournals);
router.get('/old-gold', authenticate, requirePermission('pos', 'view'), listOldGold);

export default router;
