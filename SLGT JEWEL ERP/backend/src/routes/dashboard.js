import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { getDashboardSummary } from '../controllers/dashboard.js';

const router = Router();

// GET /api/dashboard/summary
router.get('/summary', authenticate, requirePermission('dashboard', 'view'), getDashboardSummary);

export default router;
