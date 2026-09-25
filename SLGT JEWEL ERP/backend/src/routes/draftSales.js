import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  createDraft,
  listDrafts,
  getDraft,
  promoteDraft,
  cancelDraft,
  resolveConflict,
} from '../controllers/draftSales.js';

const router = Router();

router.post('/', authenticate, requirePermission('pos', 'create'), createDraft);
router.get('/', authenticate, requirePermission('pos', 'view'), listDrafts);
router.get('/:id', authenticate, requirePermission('pos', 'view'), getDraft);
router.post('/:id/promote', authenticate, requirePermission('pos', 'create'), promoteDraft);
router.post('/:id/cancel', authenticate, requirePermission('pos', 'delete'), cancelDraft);
router.post('/:id/resolve', authenticate, requirePermission('pos', 'create'), resolveConflict);

export default router;
