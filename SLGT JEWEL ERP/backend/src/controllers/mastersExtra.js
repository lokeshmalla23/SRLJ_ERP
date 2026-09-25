import { HsnCode, ProductStatusHistory, ChartOfAccount, JournalEntry, JournalLine, OldGoldReceipt } from '../models/index.js';
import { newId } from '../utils.js';
import sequelize from '../db.js';

export const listHsn = async (req, res, next) => {
  try {
    const rows = await HsnCode.findAll({ where: { is_active: true }, order: [['code', 'ASC']] });
    if (!rows.length) {
      return res.json({
        data: [
          { id: 'default-7113', code: '7113', description: 'Articles of jewellery', gst_pct: 3, is_active: true },
        ],
      });
    }
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const upsertHsn = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { code, description, gst_pct = 3, id } = req.body || {};
    if (!code) {
      await t.rollback();
      return res.status(400).json({ detail: 'code required' });
    }
    let row = id ? await HsnCode.findByPk(id, { transaction: t }) : null;
    if (!row) {
      row = await HsnCode.findOne({ where: { code: String(code) }, transaction: t });
    }
    if (row) {
      await row.update({
        code: String(code),
        description: description || row.description,
        gst_pct: Number(gst_pct),
        is_active: true,
      }, { transaction: t });
    } else {
      row = await HsnCode.create({
        id: newId(),
        shop_id: req.user?.shop_id,
        code: String(code),
        description: description || null,
        gst_pct: Number(gst_pct),
        is_active: true,
      }, { transaction: t });
    }
    await t.commit();
    return res.json(row);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

export const productStatusHistory = async (req, res, next) => {
  try {
    const rows = await ProductStatusHistory.findAll({
      where: { product_id: req.params.productId },
      order: [['created_at', 'DESC']],
      limit: 100,
    });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const listAccounts = async (req, res, next) => {
  try {
    const { ensureDefaultAccounts } = await import('../services/ledgerService.js');
    const shopId = req.user?.shop_id;
    if (shopId) await ensureDefaultAccounts(shopId);
    const rows = await ChartOfAccount.findAll({ order: [['code', 'ASC']] });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const listJournals = async (req, res, next) => {
  try {
    const entries = await JournalEntry.findAll({
      order: [['entry_date', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 50, 200),
    });
    const ids = entries.map((e) => e.id);
    const lines = ids.length
      ? await JournalLine.findAll({ where: { journal_entry_id: ids } })
      : [];
    const byEntry = {};
    for (const l of lines) {
      (byEntry[l.journal_entry_id] ||= []).push(l);
    }
    return res.json({
      data: entries.map((e) => ({ ...e.toJSON(), lines: byEntry[e.id] || [] })),
    });
  } catch (err) {
    next(err);
  }
};

export const listOldGold = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.invoice_id) where.invoice_id = req.query.invoice_id;
    if (req.query.customer_id) where.customer_id = req.query.customer_id;
    const rows = await OldGoldReceipt.findAll({ where, order: [['created_at', 'DESC']], limit: 100 });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};
