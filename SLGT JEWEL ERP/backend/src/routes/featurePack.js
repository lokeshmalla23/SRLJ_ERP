import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listMetalIssues,
  createMetalIssue,
  karigarLedger,
  listOldGoldBuybook,
  listOldGoldExchange,
  createOldGoldBuy,
  updateOldGoldTrail,
  listAvailableOldGoldForSale,
  listOldGoldSales,
  createOldGoldSale,
  cancelOldGoldSale,
  listGoldRateHistory,
  listBillingRateEvents,
  recordBillingRateEvent,
  commissionReport,
  hallmarkReport,
  gstr1Json,
  gstr3bJson,
} from '../controllers/featurePack.js';

const router = Router();

router.get('/metal-issues', authenticate, requirePermission('reports', 'view'), listMetalIssues);
router.post('/metal-issues', authenticate, requirePermission('orders', 'edit'), createMetalIssue);
router.get('/karigar/:vendorId/ledger', authenticate, requirePermission('reports', 'view'), karigarLedger);

router.get('/old-gold/buybook', authenticate, requirePermission('reports', 'view'), listOldGoldBuybook);
router.get('/old-gold/exchange', authenticate, requirePermission('reports', 'view'), listOldGoldExchange);
router.post('/old-gold/buy', authenticate, requirePermission('accounts', 'create'), createOldGoldBuy);
router.patch('/old-gold/:id/trail', authenticate, requirePermission('accounts', 'edit'), updateOldGoldTrail);

router.get('/old-gold/available', authenticate, requirePermission('accounts', 'view'), listAvailableOldGoldForSale);
router.get('/old-gold/sales', authenticate, requirePermission('accounts', 'view'), listOldGoldSales);
router.post('/old-gold/sales', authenticate, requirePermission('accounts', 'create'), createOldGoldSale);
router.post('/old-gold/sales/:id/cancel', authenticate, requirePermission('accounts', 'edit'), cancelOldGoldSale);

router.get('/gold-rate-history', authenticate, requirePermission('reports', 'view'), listGoldRateHistory);
router.get('/billing-rate-events', authenticate, requirePermission('reports', 'view'), listBillingRateEvents);
router.post('/billing-rate-events', authenticate, requirePermission('pos', 'create'), recordBillingRateEvent);

router.get('/commission', authenticate, requirePermission('reports', 'view'), commissionReport);
router.get('/hallmark', authenticate, requirePermission('reports', 'view'), hallmarkReport);

router.get('/gst/gstr1-json', authenticate, requirePermission('reports', 'view'), gstr1Json);
router.get('/gst/gstr3b-json', authenticate, requirePermission('reports', 'view'), gstr3bJson);

export default router;
