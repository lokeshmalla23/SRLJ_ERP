import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { requireApplicationFeature } from '../middleware/requireApplicationFeature.js';
import {
  listFinancialYearsHandler,
  getCurrentFinancialYearHandler,
  resolveFinancialYearHandler,
  ensureCurrentFinancialYearHandler,
  closeFinancialYearHandler,
  reopenFinancialYearHandler,
} from '../controllers/financialYear.js';

const router = Router();

// Viewing financial years uses the existing Accounts/Reports view permission.
router.get('/', authenticate, requireApplicationFeature('accounts'), requirePermission('accounts', 'view'), listFinancialYearsHandler);
router.get('/current', authenticate, requireApplicationFeature('accounts'), requirePermission('accounts', 'view'), getCurrentFinancialYearHandler);
router.get('/resolve', authenticate, requireApplicationFeature('accounts'), requirePermission('accounts', 'view'), resolveFinancialYearHandler);
router.post('/ensure-current', authenticate, requireApplicationFeature('accounts'), requirePermission('accounts', 'view'), ensureCurrentFinancialYearHandler);

// Closing / reopening a financial year is an elevated accounting/admin operation.
router.post('/:id/close', authenticate, requireApplicationFeature('accounts'), requirePermission('accounts', 'manage'), closeFinancialYearHandler);
router.post('/:id/reopen', authenticate, requireApplicationFeature('accounts'), requirePermission('accounts', 'manage'), reopenFinancialYearHandler);

export default router;
