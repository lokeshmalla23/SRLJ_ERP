import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  getQuotationSummary,
  getActiveBookingForProduct,
  listQuotations,
  getQuotation,
  getQuotationByNo,
  createQuotation,
  updateQuotation,
  updateQuotationStatus,
  convertQuotation,
  bookQuotationAdvance,
  addQuotationAdvanceInstallment,
  cancelBookedQuotation,
  deleteQuotation,
} from '../controllers/quotations.js';

const router = Router();

// GET /api/quotations/summary
router.get('/summary', authenticate, requirePermission('quotations', 'view'), getQuotationSummary);

// GET /api/quotations/active-booking — POS check before adding a booked tag (must precede /:id)
router.get(
  '/active-booking',
  authenticate,
  requireAnyPermission(['pos', 'view'], ['quotations', 'view']),
  getActiveBookingForProduct,
);

// GET /api/quotations
router.get('/', authenticate, requirePermission('quotations', 'view'), listQuotations);

// GET /api/quotations/by-no/:quoteNo  (must be before /:id)
router.get('/by-no/:quoteNo', authenticate, requirePermission('quotations', 'view'), getQuotationByNo);

// GET /api/quotations/:id
router.get('/:id', authenticate, requirePermission('quotations', 'view'), getQuotation);

// POST /api/quotations
router.post('/', authenticate, requirePermission('quotations', 'create'), createQuotation);

// PUT /api/quotations/:id
router.put('/:id', authenticate, requirePermission('quotations', 'edit'), updateQuotation);

// PUT /api/quotations/:id/status
router.put('/:id/status', authenticate, requirePermission('quotations', 'edit'), updateQuotationStatus);

// POST /api/quotations/:id/convert
router.post('/:id/convert', authenticate, requirePermission('quotations', 'edit'), convertQuotation);

// POST /api/quotations/:id/book
router.post('/:id/book', authenticate, requirePermission('quotations', 'edit'), bookQuotationAdvance);

// POST /api/quotations/:id/add-advance — extra installment while booked
router.post('/:id/add-advance', authenticate, requirePermission('quotations', 'edit'), addQuotationAdvanceInstallment);

// POST /api/quotations/:id/cancel-booking
router.post('/:id/cancel-booking', authenticate, requirePermission('quotations', 'edit'), cancelBookedQuotation);

// DELETE /api/quotations/:id
router.delete('/:id', authenticate, requirePermission('quotations', 'delete'), deleteQuotation);

export default router;
