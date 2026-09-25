import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { reserve, commit, release, listLeases } from '../controllers/authority.js';

const router = Router();

// All routes require authentication (device token carries shop_id)
router.use(authenticate);

// POST /api/authority/reserve — pre-commit exclusive reservation
router.post('/reserve', reserve);

// POST /api/authority/commit — mark lease as committed
router.post('/commit', commit);

// POST /api/authority/release — release lease on cancel/crash
router.post('/release', release);

// GET /api/authority/leases — list leases (diagnostics)
router.get('/leases', listLeases);

export default router;
