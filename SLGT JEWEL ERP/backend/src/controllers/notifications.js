import { Op } from 'sequelize';
import { Notification } from '../models/index.js';
import { newId } from '../utils.js';

// ─── Helper: create a notification (exported for use by other modules) ────────
export async function createNotification({ type, title, message, data = null, user_id = null, shop_id = null }) {
  return Notification.create({
    id: newId(),
    type,
    title,
    message,
    data,
    is_read: false,
    user_id,
    shop_id,
  });
}

// Include both user-specific and system-wide (user_id IS NULL) notifications
function notifWhere(user_id) {
  return { [Op.or]: [{ user_id }, { user_id: null }] };
}

// GET /api/notifications
export const listNotifications = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const where = notifWhere(req.user.id);

    const [notifications, unread_count] = await Promise.all([
      Notification.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit,
        offset,
      }),
      Notification.count({ where: { ...where, is_read: false } }),
    ]);

    return res.json({
      notifications: notifications.map((n) => n.toJSON()),
      unread_count,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/notifications/read-all
export const markAllRead = async (req, res, next) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { ...notifWhere(req.user.id), is_read: false } },
    );
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// PUT /api/notifications/:id/read
export const markOneRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, ...notifWhere(req.user.id) },
    });
    if (!notification) return res.status(404).json({ detail: 'Notification not found' });
    await notification.update({ is_read: true });
    return res.json(notification.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/notifications/:id
export const deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, ...notifWhere(req.user.id) },
    });
    if (!notification) return res.status(404).json({ detail: 'Notification not found' });
    await notification.destroy();
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications
export const createNotificationHandler = async (req, res, next) => {
  try {
    const { type, title, message, data, user_id } = req.body;
    if (!type || !title || !message) {
      return res.status(400).json({ detail: 'type, title, and message are required' });
    }
    const notification = await createNotification({ type, title, message, data, user_id: user_id || null });
    return res.status(201).json(notification.toJSON());
  } catch (err) {
    next(err);
  }
};
