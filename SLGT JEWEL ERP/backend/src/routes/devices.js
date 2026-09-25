import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { requireHostRole } from '../middleware/requireHostRole.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  createPairingCode,
  getShopJoinCode,
  setShopJoinCode,
  employeeJoin,
  listWaitingDevices,
  assignDevicePin,
  enableJoinReady,
  disableJoinReady,
  listDevices,
  registerDevice,
  discoveryInfo,
  discover,
  heartbeat,
  initiateOwnershipTransfer,
  markTransferNeonReady,
  getOwnerTransferStatus,
  completeOwnershipTransfer,
  cancelOwnershipTransfer,
  exportDb,
  deleteDevice,
  revokeDevice,
  getLanCredential,
} from '../controllers/devices.js';
import {
  requestJoin,
  getJoinStatus,
  claimApproval,
  approveDevice,
  declineDevice,
  renameDevice,
} from '../controllers/deviceAuthorization.js';

const router = Router();

const joinLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keySuffix: 'device-join' });
const pairLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keySuffix: 'pairing' });
const transferLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keySuffix: 'transfer' });
const statusLimit = rateLimit({ windowMs: 60 * 1000, max: 120, keySuffix: 'join-status' });

router.get('/discovery', discoveryInfo);
router.get('/discover', discover);
router.post('/register', joinLimit, registerDevice);
router.post('/employee-join', joinLimit, employeeJoin);
router.post('/request-join', joinLimit, requestJoin);
router.get('/join-status', statusLimit, getJoinStatus);
router.post('/claim-approval', joinLimit, claimApproval);
router.post('/join-ready', enableJoinReady);
router.delete('/join-ready', disableJoinReady);
router.post('/heartbeat', heartbeat);

router.get('/', authenticate, requirePermission('settings', 'view'), requireHostRole, listDevices);
router.get('/lan-credential', authenticate, getLanCredential);
router.post('/pairing-code', authenticate, requirePermission('settings', 'manage'), requireHostRole, pairLimit, createPairingCode);
router.get('/shop-join-code', authenticate, requirePermission('settings', 'view'), requireHostRole, getShopJoinCode);
router.put('/shop-join-code', authenticate, requirePermission('settings', 'manage'), requireHostRole, setShopJoinCode);
router.post('/shop-join-code', authenticate, requirePermission('settings', 'manage'), requireHostRole, setShopJoinCode);
router.get('/waiting', authenticate, requirePermission('settings', 'manage'), requireHostRole, listWaitingDevices);
router.post('/assign-pin', authenticate, requirePermission('settings', 'manage'), requireHostRole, pairLimit, assignDevicePin);

// Ownership transfer routes
router.get('/export-db', authenticate, requireHostRole, transferLimit, exportDb);
router.post('/transfer/neon-ready', authenticate, requirePermission('settings', 'manage'), requireHostRole, markTransferNeonReady);
router.post('/transfer/complete', authenticate, requireHostRole, transferLimit, completeOwnershipTransfer);
router.post('/transfer/cancel', authenticate, requirePermission('settings', 'manage'), requireHostRole, cancelOwnershipTransfer);
router.get('/transfer-status', authenticate, requirePermission('settings', 'manage'), requireHostRole, getOwnerTransferStatus);
router.post('/transfer/:deviceId', authenticate, requirePermission('settings', 'manage'), requireHostRole, transferLimit, initiateOwnershipTransfer);
router.post('/:id/approve', authenticate, requirePermission('settings', 'manage'), requireHostRole, approveDevice);
router.post('/:id/decline', authenticate, requirePermission('settings', 'manage'), requireHostRole, declineDevice);
router.patch('/:id', authenticate, requirePermission('settings', 'manage'), requireHostRole, renameDevice);
router.post('/:id/revoke', authenticate, requirePermission('settings', 'manage'), requireHostRole, revokeDevice);
router.delete('/:id', authenticate, requirePermission('settings', 'manage'), requireHostRole, deleteDevice);

export default router;
