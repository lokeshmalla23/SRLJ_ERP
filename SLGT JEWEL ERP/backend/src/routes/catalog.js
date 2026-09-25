import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listAttributes,
  listAttributesForProduct,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  listCatalogKind,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
} from '../controllers/catalog.js';

const router = Router();

// ─── Categories ───────────────────────────────────────────────────────────────

// GET /api/categories
router.get('/categories', authenticate, listCategories);

// POST /api/categories
router.post('/categories', authenticate, requirePermission('catalog', 'create'), createCategory);

// PATCH /api/categories/:id
router.patch('/categories/:id', authenticate, requirePermission('catalog', 'edit'), updateCategory);

// DELETE /api/categories/:id
router.delete('/categories/:id', authenticate, requirePermission('catalog', 'delete'), deleteCategory);

// ─── Attributes ───────────────────────────────────────────────────────────────

// GET /api/attributes
router.get('/attributes', authenticate, listAttributes);

// GET /api/attributes/for-product
router.get('/attributes/for-product', authenticate, listAttributesForProduct);

// POST /api/attributes
router.post('/attributes', authenticate, requirePermission('catalog', 'create'), createAttribute);

// PATCH /api/attributes/:id
router.patch('/attributes/:id', authenticate, requirePermission('catalog', 'edit'), updateAttribute);

// DELETE /api/attributes/:id
router.delete('/attributes/:id', authenticate, requirePermission('catalog', 'delete'), deleteAttribute);

// ─── Catalog lookups ──────────────────────────────────────────────────────────

// GET /api/catalog/:kind
router.get('/catalog/:kind', authenticate, listCatalogKind);

// POST /api/catalog/:kind
router.post('/catalog/:kind', authenticate, requirePermission('catalog', 'create'), createCatalogItem);

// PATCH /api/catalog/:kind/:id
router.patch('/catalog/:kind/:id', authenticate, requirePermission('catalog', 'edit'), updateCatalogItem);

// DELETE /api/catalog/:kind/:id
router.delete('/catalog/:kind/:id', authenticate, requirePermission('catalog', 'delete'), deleteCatalogItem);

export default router;
