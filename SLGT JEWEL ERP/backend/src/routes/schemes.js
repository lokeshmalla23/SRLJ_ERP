import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { requireApplicationFeature } from '../middleware/requireApplicationFeature.js';
import {
  getPaymentsDue,
  listSchemes,
  getScheme,
  createScheme,
  addSchemePayment,
  redeemScheme,
} from '../controllers/schemes.js';

const router = Router();

const goldSchemesEnabled = requireApplicationFeature('gold_schemes');

// GET /api/schemes/payments-due — no application-feature gate: unclear whether
// this reminder feed is a shared dependency outside the Gold Schemes screen
// (no current frontend caller found, but nothing rules out a future one), so
// left open rather than risk breaking something else. Also has no RBAC gate.
router.get('/payments-due', authenticate, getPaymentsDue);

// GET /api/schemes
router.get('/', authenticate, goldSchemesEnabled, requirePermission('gold_schemes', 'view'), listSchemes);

// GET /api/schemes/:id
router.get('/:id', authenticate, goldSchemesEnabled, requirePermission('gold_schemes', 'view'), getScheme);

// POST /api/schemes
router.post('/', authenticate, goldSchemesEnabled, requirePermission('gold_schemes', 'create'), createScheme);

// POST /api/schemes/:id/payments
router.post('/:id/payments', authenticate, goldSchemesEnabled, requirePermission('gold_schemes', 'edit'), addSchemePayment);

// POST /api/schemes/:id/redeem
router.post('/:id/redeem', authenticate, goldSchemesEnabled, requirePermission('gold_schemes', 'edit'), redeemScheme);

export default router;
