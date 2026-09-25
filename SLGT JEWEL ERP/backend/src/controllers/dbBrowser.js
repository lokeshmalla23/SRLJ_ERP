import { listTables, describeTable, browseTable } from '../services/dbBrowserService.js';

function requireOwner(req, res) {
  const role = String(req.user?.role || '');
  if (role !== 'shop_owner' && role !== 'owner' && role !== 'super_admin') {
    res.status(403).json({ detail: 'Shop owner access required' });
    return false;
  }
  return true;
}

export const getDbTables = async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    return res.json(await listTables());
  } catch (err) {
    next(err);
  }
};

export const getDbTableSchema = async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    return res.json(await describeTable(req.params.table));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
};

export const getDbTableRows = async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    const data = await browseTable(req.params.table, {
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
      orderBy: req.query.order_by,
      orderDir: req.query.order_dir,
    });
    return res.json(data);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
};
