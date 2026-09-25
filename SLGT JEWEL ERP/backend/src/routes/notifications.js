import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  listNotifications,
  markAllRead,
  markOneRead,
  deleteNotification,
  createNotificationHandler,
} from '../controllers/notifications.js';

const router = Router();

// GET /api/notifications
router.get('/', authenticate, listNotifications);

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, markAllRead);

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, markOneRead);

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, deleteNotification);

// POST /api/notifications
router.post('/', authenticate, createNotificationHandler);

export default router;
