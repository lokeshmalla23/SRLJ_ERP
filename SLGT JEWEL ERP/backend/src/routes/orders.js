import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listOrders,
  getOrderSummary,
  getTodayDeliveries,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderStatus,
  updateKarigar,
  deleteOrder,
} from '../controllers/orders.js';

const router = Router();

// GET /api/orders
router.get('/', authenticate, requirePermission('orders', 'view'), listOrders);

// GET /api/orders/summary
router.get('/summary', authenticate, requirePermission('orders', 'view'), getOrderSummary);

// GET /api/orders/today-deliveries
router.get('/today-deliveries', authenticate, requirePermission('orders', 'view'), getTodayDeliveries);

// GET /api/orders/:id
router.get('/:id', authenticate, requirePermission('orders', 'view'), getOrder);

// POST /api/orders
router.post('/', authenticate, requirePermission('orders', 'create'), createOrder);

// PUT /api/orders/:id
router.put('/:id', authenticate, requirePermission('orders', 'edit'), updateOrder);

// PUT /api/orders/:id/status
router.put('/:id/status', authenticate, requirePermission('orders', 'edit'), updateOrderStatus);

// PATCH /api/orders/:id/karigar
router.patch('/:id/karigar', authenticate, requirePermission('orders', 'edit'), updateKarigar);

// DELETE /api/orders/:id
router.delete('/:id', authenticate, requirePermission('orders', 'delete'), deleteOrder);

export default router;
