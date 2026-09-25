import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDbTables, getDbTableSchema, getDbTableRows } from '../controllers/dbBrowser.js';

const router = Router();

router.get('/tables', authenticate, getDbTables);
router.get('/tables/:table', authenticate, getDbTableSchema);
router.get('/tables/:table/rows', authenticate, getDbTableRows);

export default router;
