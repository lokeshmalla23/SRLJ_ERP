import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { listInvoices, getInvoice, createInvoice, cancelInvoice, collectPayment, customerOutstanding } from '../controllers/invoices.js';
import { partialReturn, listCreditNotes } from '../controllers/returns.js';

const router = Router();

router.get('/', authenticate, requirePermission('pos', 'view'), listInvoices);
router.get('/credit-notes', authenticate, requirePermission('pos', 'view'), listCreditNotes);
router.post('/', authenticate, requirePermission('pos', 'create'), createInvoice);
router.get('/customer/:customerId/outstanding', authenticate, requirePermission('pos', 'view'), customerOutstanding);
router.get('/:id', authenticate, requirePermission('pos', 'view'), getInvoice);
router.post('/:id/cancel', authenticate, requirePermission('pos', 'delete'), cancelInvoice);
router.post('/:id/return', authenticate, requirePermission('pos', 'delete'), partialReturn);
router.post('/:id/payment', authenticate, requirePermission('pos', 'create'), collectPayment);

export default router;
