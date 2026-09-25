import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  writeRecoverySnapshot,
  readLatestSnapshot,
  promoteToActiveHost,
  fenceIfSuperseded,
} from '../services/recoveryService.js';

const router = Router();

router.get('/status', authenticate, async (req, res, next) => {
  try {
    const latest = readLatestSnapshot();
    const fence = await fenceIfSuperseded();
    res.json({
      snapshot: latest
        ? {
            created_at: latest.payload.created_at,
            schema_version: latest.payload.schema_version,
            pending: latest.payload.sync_outbox_pending?.length || 0,
            host: latest.payload.host,
          }
        : null,
      fence,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/snapshot', authenticate, requirePermission('settings', 'manage'), async (req, res, next) => {
  try {
    const result = await writeRecoverySnapshot();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/promote', authenticate, requirePermission('settings', 'manage'), async (req, res, next) => {
  try {
    const result = await promoteToActiveHost({
      confirmDualActiveRisk: Boolean(req.body?.confirm_dual_active_risk),
      deviceIdentifier: req.body?.device_identifier,
      deviceName: req.body?.device_name,
    });
    res.json(result);
  } catch (err) {
    if (err.code) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
});

export default router;
