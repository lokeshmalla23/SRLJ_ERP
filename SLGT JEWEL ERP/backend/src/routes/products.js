import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  listProducts,
  getProduct,
  getNextProductCode,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProductsByBarcode,
  nextBarcode,
  setProductDisplayStatus,
} from '../controllers/products.js';

const router = Router();

// GET /api/products — POS also needs this for item lookup
router.get('/', authenticate, requireAnyPermission(['pos', 'view'], ['inventory', 'view']), listProducts);

// GET /api/products/barcode-search — POS autocomplete (must precede /:id)
router.get('/barcode-search', authenticate, requireAnyPermission(['pos', 'view'], ['inventory', 'view']), searchProductsByBarcode);

// GET /api/products/next-barcode — sequential barcode preview for New Product (must precede /:id)
router.get('/next-barcode', authenticate, requirePermission('inventory', 'create'), nextBarcode);

// GET /api/products/next-code?category_id=…  (must be before /:id)
router.get('/next-code', authenticate, requirePermission('inventory', 'create'), getNextProductCode);

// GET /api/products/:id
router.get('/:id', authenticate, requirePermission('inventory', 'view'), getProduct);

// POST /api/products
router.post('/', authenticate, requirePermission('inventory', 'create'), createProduct);

// PATCH /api/products/:id
router.patch('/:id', authenticate, requirePermission('inventory', 'edit'), updateProduct);

// PATCH /api/products/:id/display — toggle On Display ⇄ Available
router.patch('/:id/display', authenticate, requirePermission('inventory', 'edit'), setProductDisplayStatus);

// DELETE /api/products/:id
router.delete('/:id', authenticate, requirePermission('inventory', 'delete'), deleteProduct);

export default router;
