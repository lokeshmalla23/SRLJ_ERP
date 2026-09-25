import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
  generateMissingBarcodes,
  getBarcodeStats,
} from '../controllers/barcodes.js';

const router = Router();

// GET /api/barcodes/templates
router.get('/templates', authenticate, requirePermission('barcodes', 'view'), listTemplates);

// POST /api/barcodes/templates
router.post('/templates', authenticate, requirePermission('barcodes', 'create'), createTemplate);

// PUT /api/barcodes/templates/:id
router.put('/templates/:id', authenticate, requirePermission('barcodes', 'edit'), updateTemplate);

// DELETE /api/barcodes/templates/:id
router.delete('/templates/:id', authenticate, requirePermission('barcodes', 'delete'), deleteTemplate);

// POST /api/barcodes/templates/:id/set-default
router.post('/templates/:id/set-default', authenticate, requirePermission('barcodes', 'edit'), setDefaultTemplate);

// POST /api/barcodes/generate-missing
router.post('/generate-missing', authenticate, requirePermission('barcodes', 'manage'), generateMissingBarcodes);

// GET /api/barcodes/stats
router.get('/stats', authenticate, requirePermission('barcodes', 'view'), getBarcodeStats);

export default router;
