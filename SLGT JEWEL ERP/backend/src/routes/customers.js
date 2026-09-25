import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listCustomers,
  getCustomer,
  getCustomer360,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../controllers/customers.js';

const router = Router();

// GET /api/customers — POS also needs this for customer assignment
router.get('/', authenticate, requireAnyPermission(['pos', 'view'], ['customers', 'view']), listCustomers);

// GET /api/customers/:id/360 — must be before :id
router.get('/:id/360', authenticate, requirePermission('customers', 'view'), getCustomer360);

// GET /api/customers/:id
router.get('/:id', authenticate, requirePermission('customers', 'view'), getCustomer);

// POST /api/customers — POS also creates walk-in customers
router.post('/', authenticate, requireAnyPermission(['pos', 'view'], ['customers', 'create']), createCustomer);

// PATCH /api/customers/:id
router.patch('/:id', authenticate, requirePermission('customers', 'edit'), updateCustomer);

// DELETE /api/customers/:id
router.delete('/:id', authenticate, requirePermission('customers', 'delete'), deleteCustomer);

export default router;
