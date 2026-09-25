import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { login, getMe, verifyPasswordHandler, getCredential } from '../controllers/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// POST /api/auth/login
router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 15, keySuffix: 'login' }), login);

// GET /api/auth/me
router.get('/me', authenticate, getMe);

// POST /api/auth/verify-password
router.post('/verify-password', authenticate, verifyPasswordHandler);

// GET /api/auth/credential — returns own bcrypt hash for offline cache (desktop only)
router.get('/credential', authenticate, getCredential);

export default router;
