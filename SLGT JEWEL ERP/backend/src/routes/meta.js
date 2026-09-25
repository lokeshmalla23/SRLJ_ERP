import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getRoles, getDefaultPermissions } from '../controllers/meta.js';

const router = Router();

// GET /api/meta/roles
router.get('/roles', authenticate, getRoles);

// GET /api/meta/default-permissions/:role
router.get('/default-permissions/:role', authenticate, getDefaultPermissions);

export default router;
