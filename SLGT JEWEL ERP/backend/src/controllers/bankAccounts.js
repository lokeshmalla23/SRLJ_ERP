/**
 * Named bank accounts + reconciliation match workflow.
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import { BankAccount, BankReconciliationItem } from '../models/index.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { accountNetBalance, ensureDefaultAccounts } from '../services/ledgerService.js';
import { generalLedger } from '../services/accountingControlsService.js';
import { toMoneyNumber } from '../utils/money.js';

export const listBankAccounts = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    await ensureDefaultAccounts(shopId);
    const rows = await BankAccount.findAll({
      where: { shop_id: shopId, status: { [Op.ne]: 'deleted' } },
      order: [['name', 'ASC']],
    });
    const enriched = [];
    for (const r of rows) {
      const gl = await accountNetBalance(shopId, r.gl_code || '1010');
      enriched.push({
        ...r.toJSON(),
        gl_balance: toMoneyNumber(gl),
        current_balance: toMoneyNumber(Number(r.opening_balance || 0) + gl),
      });
    }
    return res.json({ data: enriched });
  } catch (err) {
    next(err);
  }
};

export const createBankAccount = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const {
      name, bank_name, account_number, ifsc, gl_code = '1010', opening_balance = 0, notes,
    } = req.body || {};
    if (!name) return res.status(400).json({ detail: 'name required' });
    const code = ['1010', '1020', '1030'].includes(String(gl_code)) ? String(gl_code) : '1010';
    const row = await BankAccount.create({
      id: newId(),
      shop_id: shopId,
      name,
      bank_name: bank_name || null,
      account_number: account_number || null,
      ifsc: ifsc || null,
      gl_code: code,
      opening_balance: Number(opening_balance) || 0,
      status: 'active',
      notes: notes || null,
    });
    return res.status(201).json(row);
  } catch (err) {
    next(err);
  }
};

export const updateBankAccount = async (req, res, next) => {
  try {
    const row = await BankAccount.findByPk(req.params.id);
    if (!row) return res.status(404).json({ detail: 'Not found' });
    const allowed = ['name', 'bank_name', 'account_number', 'ifsc', 'gl_code', 'opening_balance', 'status', 'notes'];
    const updates = {};
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.gl_code && !['1010', '1020', '1030'].includes(String(updates.gl_code))) {
      return res.status(400).json({ detail: 'gl_code must be 1010, 1020, or 1030' });
    }
    await row.update(updates);
    return res.json(row);
  } catch (err) {
    next(err);
  }
};

/** Reconciliation workspace: GL lines for bank GL + match status. */
export const getReconciliation = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const bankId = req.query.bank_account_id || req.params.id;
    const from = req.query.from;
    const to = req.query.to;
    let bank = null;
    if (bankId) bank = await BankAccount.findByPk(bankId);
    const glCode = bank?.gl_code || req.query.account || '1010';
    const gl = await generalLedger({ shopId, accountCode: glCode, from, to, limit: 1000 });
    const erpBalance = await accountNetBalance(shopId, glCode, { to: to || undefined });

    const marks = await BankReconciliationItem.findAll({
      where: {
        shop_id: shopId,
        ...(bank ? { bank_account_id: bank.id } : {}),
      },
    });
    const byLine = new Map(marks.map((m) => [m.journal_line_id, m]));

    const rows = (gl.lines || []).map((l) => {
      const mark = byLine.get(l.journal_entry_id) || [...byLine.values()].find(
        (m) => m.journal_entry_id === l.journal_entry_id && Number(m.amount) === Number(l.debit - l.credit),
      );
      // Prefer match by reconstructing synthetic line key from entry+amounts
      const lineKey = `${l.journal_entry_id}:${l.debit}:${l.credit}`;
      const mark2 = marks.find((m) => m.notes === lineKey || m.journal_line_id === lineKey);
      const status = mark2?.status || mark?.status || 'unmatched';
      return {
        ...l,
        line_key: lineKey,
        amount: toMoneyNumber((Number(l.debit) || 0) - (Number(l.credit) || 0)),
        recon_status: status,
        statement_ref: mark2?.statement_ref || mark?.statement_ref || null,
        reconciled_at: mark2?.reconciled_at || mark?.reconciled_at || null,
      };
    });

    const matched = rows.filter((r) => r.recon_status === 'matched').length;
    const unmatched = rows.filter((r) => r.recon_status !== 'matched').length;
    const statementBalance = req.query.statement_balance != null
      ? Number(req.query.statement_balance)
      : null;

    return res.json({
      bank_account: bank,
      gl_code: glCode,
      erp_balance: toMoneyNumber(erpBalance),
      statement_balance: statementBalance,
      difference: statementBalance != null ? toMoneyNumber(erpBalance - statementBalance) : null,
      matched_count: matched,
      unmatched_count: unmatched,
      rows,
    });
  } catch (err) {
    next(err);
  }
};

/** Mark a GL line matched / unmatched / pending against bank statement. */
export const upsertReconciliationMark = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = await getDefaultShopId({ transaction: t });
    const {
      bank_account_id,
      journal_entry_id,
      line_key,
      amount,
      entry_date,
      description,
      status = 'matched',
      statement_ref,
      statement_date,
      notes,
    } = req.body || {};

    if (!bank_account_id) {
      await t.rollback();
      return res.status(400).json({ detail: 'bank_account_id required' });
    }
    if (!['matched', 'unmatched', 'pending'].includes(status)) {
      await t.rollback();
      return res.status(400).json({ detail: 'status must be matched|unmatched|pending' });
    }

    const key = line_key || journal_entry_id;
    let row = await BankReconciliationItem.findOne({
      where: {
        shop_id: shopId,
        bank_account_id,
        journal_line_id: key,
      },
      transaction: t,
    });

    if (!row) {
      row = await BankReconciliationItem.create({
        id: newId(),
        shop_id: shopId,
        bank_account_id,
        journal_entry_id: journal_entry_id || null,
        journal_line_id: key,
        entry_date: entry_date || null,
        description: description || null,
        amount: Number(amount) || 0,
        status,
        statement_ref: statement_ref || null,
        statement_date: statement_date || null,
        reconciled_at: status === 'matched' ? new Date() : null,
        reconciled_by: req.user?.id || null,
        notes: notes || line_key || null,
      }, { transaction: t });
    } else {
      await row.update({
        status,
        statement_ref: statement_ref !== undefined ? statement_ref : row.statement_ref,
        statement_date: statement_date !== undefined ? statement_date : row.statement_date,
        reconciled_at: status === 'matched' ? new Date() : null,
        reconciled_by: req.user?.id || null,
        notes: notes !== undefined ? notes : row.notes,
        amount: amount !== undefined ? Number(amount) : row.amount,
      }, { transaction: t });
    }

    await t.commit();
    return res.json(row);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
