import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { requireApplicationFeature } from '../middleware/requireApplicationFeature.js';
import {
  listDepartments,
  getSummary,
  listEmployees,
  createEmployee,
  getEmployee,
  updateEmployee,
  deleteEmployee,
} from '../controllers/employees.js';

const router = Router();

const employeesEnabled = requireApplicationFeature('employees');

// GET /api/employees/departments
router.get('/departments', authenticate, employeesEnabled, requirePermission('employees', 'view'), listDepartments);

// GET /api/employees/summary
router.get('/summary', authenticate, employeesEnabled, requirePermission('employees', 'view'), getSummary);

// GET /api/employees — POS also needs this for the salesperson dropdown, so it
// is NOT gated behind the `employees` application feature: disabling the
// standalone Employees module must not break POS's salesperson lookup.
router.get('/', authenticate, requireAnyPermission(['pos', 'view'], ['employees', 'view']), listEmployees);

// POST /api/employees
router.post('/', authenticate, employeesEnabled, requirePermission('employees', 'create'), createEmployee);

// GET /api/employees/:id
router.get('/:id', authenticate, employeesEnabled, requirePermission('employees', 'view'), getEmployee);

// PUT /api/employees/:id
router.put('/:id', authenticate, employeesEnabled, requirePermission('employees', 'edit'), updateEmployee);

// DELETE /api/employees/:id
router.delete('/:id', authenticate, employeesEnabled, requirePermission('employees', 'delete'), deleteEmployee);

export default router;
