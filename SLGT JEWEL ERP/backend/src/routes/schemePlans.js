import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listSchemePlans,
  createSchemePlan,
  updateSchemePlan,
  deleteSchemePlan,
} from '../controllers/schemePlans.js';

const router = Router();

// GET /api/scheme-plans
router.get('/', authenticate, requirePermission('gold_schemes', 'view'), listSchemePlans);

// POST /api/scheme-plans
router.post('/', authenticate, requirePermission('gold_schemes', 'create'), createSchemePlan);

// PATCH /api/scheme-plans/:id
router.patch('/:id', authenticate, requirePermission('gold_schemes', 'edit'), updateSchemePlan);

// DELETE /api/scheme-plans/:id
router.delete('/:id', authenticate, requirePermission('gold_schemes', 'delete'), deleteSchemePlan);

export default router;
