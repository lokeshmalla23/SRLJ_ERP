import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getVendorSummary,
  listVendors,
  createVendor,
  getVendor,
  updateVendor,
  deleteVendor,
} from '../controllers/vendors.js';

const router = Router();

// GET /api/vendors/summary
router.get('/summary', authenticate, requirePermission('vendors', 'view'), getVendorSummary);

// GET /api/vendors
router.get('/', authenticate, requirePermission('vendors', 'view'), listVendors);

// POST /api/vendors
router.post('/', authenticate, requirePermission('vendors', 'create'), createVendor);

// GET /api/vendors/:id
router.get('/:id', authenticate, requirePermission('vendors', 'view'), getVendor);

// PUT /api/vendors/:id
router.put('/:id', authenticate, requirePermission('vendors', 'edit'), updateVendor);

// DELETE /api/vendors/:id
router.delete('/:id', authenticate, requirePermission('vendors', 'delete'), deleteVendor);

export default router;
