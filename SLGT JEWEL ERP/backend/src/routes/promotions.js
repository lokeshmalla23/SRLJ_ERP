import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listTemplates,
  previewSegment,
  listCampaigns,
  createCampaign,
  getCampaign,
  deleteCampaign,
  sendCampaign,
} from '../controllers/promotions.js';

const router = Router();

// GET /api/promotions/templates
router.get('/templates', authenticate, requirePermission('promotions', 'view'), listTemplates);

// GET /api/promotions/segments/preview
router.get('/segments/preview', authenticate, requirePermission('promotions', 'view'), previewSegment);

// GET /api/promotions/campaigns
router.get('/campaigns', authenticate, requirePermission('promotions', 'view'), listCampaigns);

// POST /api/promotions/campaigns
router.post('/campaigns', authenticate, requirePermission('promotions', 'create'), createCampaign);

// GET /api/promotions/campaigns/:id
router.get('/campaigns/:id', authenticate, requirePermission('promotions', 'view'), getCampaign);

// DELETE /api/promotions/campaigns/:id
router.delete('/campaigns/:id', authenticate, requirePermission('promotions', 'delete'), deleteCampaign);

// POST /api/promotions/campaigns/:id/send
router.post('/campaigns/:id/send', authenticate, requirePermission('promotions', 'manage'), sendCampaign);

export default router;
