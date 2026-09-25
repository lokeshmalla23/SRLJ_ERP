import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  list,
  getOne,
  create,
  update,
  remove,
} from '../controllers/pureProducts.js';

const router = Router();

// POS needs list for dropdown; inventory for management
router.get('/', authenticate, requireAnyPermission(['pos', 'view'], ['inventory', 'view']), list);
router.get('/:id', authenticate, requireAnyPermission(['pos', 'view'], ['inventory', 'view']), getOne);
router.post('/', authenticate, requirePermission('inventory', 'create'), create);
router.patch('/:id', authenticate, requirePermission('inventory', 'edit'), update);
router.delete('/:id', authenticate, requirePermission('inventory', 'delete'), remove);

export default router;
