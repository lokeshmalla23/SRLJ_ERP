import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { globalSearch } from '../controllers/search.js';

const router = Router();

// GET /api/search
router.get('/', authenticate, globalSearch);

export default router;
