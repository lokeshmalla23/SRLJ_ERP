import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, deleteUser, deleteOrphanUsers } from '../controllers/users.js';

const router = Router();

// GET /api/users
router.get('/', authenticate, requirePermission('users', 'view'), listUsers);

// POST /api/users
router.post('/', authenticate, requirePermission('users', 'create'), createUser);

// PATCH /api/users/:id
router.patch('/:id', authenticate, requirePermission('users', 'edit'), updateUser);

// DELETE /api/users/orphans — remove user accounts with no linked employee
router.delete('/orphans', authenticate, requirePermission('users', 'delete'), deleteOrphanUsers);

// DELETE /api/users/:id
router.delete('/:id', authenticate, requirePermission('users', 'delete'), deleteUser);

export default router;
