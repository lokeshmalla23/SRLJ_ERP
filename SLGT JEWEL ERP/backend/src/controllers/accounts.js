import { Op } from 'sequelize';
import sequelize from '../db.js';
import { DailyClosing, Expense, ExpenseCategory, Income, Invoice, Scheme } from '../models/index.js';
import { likeOp } from '../db.js';
import { newId, parseMultiParam } from '../utils.js';
import { toMoneyNumber } from '../utils/money.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { excludePreAccountsWhere, isPreAccountsRecord, withLiveFinancialRecords } from '../services/financialMode.js';
import { buildDaySnapshot, saveDailyClosing, saveTillOpeningCash, getActiveBillingDate } from '../services/dailyClosingService.js';
import { invoiceDateRangeWhere } from '../utils/reportQuery.js';
import { invoiceOccurredAt } from '../utils/invoiceRead.js';
import { wantsHiddenBills } from '../utils/invoiceVisibility.js';

/** Current local clock time as HH:MM — default for Expense/Income time when left blank. */
function currentTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** YYYY-MM-DD from Date / ISO / SQLite text — never throws. */
function localDateKey(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function includeHiddenFromReq(req) {
  return wantsHiddenBills({ ...req.query, ...req.body, _role: req.user?.role });
}

// GET /api/accounts/daily-closings
export const listDailyClosings = async (req, res, next) => {
  try {
    const { from, to, date, limit = 30, offset = 0 } = req.query;
    const shopId = await getDefaultShopId();
    const where = { shop_id: shopId };

    if (date) {
      where.date = date;
    } else if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from;
      if (to) where.date[Op.lte] = to;
    }

    const closings = await DailyClosing.findAll({
      where,
      order: [['date', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return res.json(closings.map((c) => c.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts/daily-closings/till-opening — save go-live drawer float (locks immediately)
export const setTillOpeningCash = async (req, res, next) => {
  try {
    const { amount, opening_cash } = req.body || {};
    const raw = amount ?? opening_cash;
    const result = await saveTillOpeningCash(raw, { userId: req.user?.id || null });
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        detail: err.message,
        amount: err.amount,
      });
    }
    next(err);
  }
};

// GET /api/accounts/active-billing-date — the open business day new transactions are stamped with
export const getActiveBillingDateHandler = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const active = await getActiveBillingDate({ shopId });
    return res.json(active);
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/daily-closings/:date/preview — full EOD snapshot for the UI
export const previewDailyClosing = async (req, res, next) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ detail: 'date must be YYYY-MM-DD' });
    }
    const snapshot = await buildDaySnapshot(date, { includeHidden: includeHiddenFromReq(req) });
    return res.json(snapshot);
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts/daily-closings
export const createDailyClosing = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      date,
      opening_cash,
      closing_cash,
      cash_received,
      upi_received,
      card_received,
      bank_received,
      notes,
      checklist,
      final_check,
      status = 'draft',
      use_system_totals = true,
    } = req.body;

    if (!date) {
      await t.rollback();
      return res.status(400).json({ detail: 'date is required' });
    }

    const shopId = await getDefaultShopId({ transaction: t });
    const existing = await DailyClosing.findOne({
      where: { shop_id: shopId, date },
      transaction: t,
    });
    if (existing) {
      await t.rollback();
      return res.status(409).json({
        detail: `Daily closing for ${date} already exists — use PUT to update`,
        id: existing.id,
      });
    }

    const result = await saveDailyClosing({
      date,
      opening_cash,
      closing_cash,
      cash_received,
      upi_received,
      card_received,
      bank_received,
      notes,
      checklist,
      final_check,
      status,
      userId: req.user?.id || null,
      forceSystemTotals: use_system_totals !== false,
      includeHidden: includeHiddenFromReq(req),
      transaction: t,
    });

    await t.commit();
    return res.status(201).json(result.closing);
  } catch (err) {
    await t.rollback().catch(() => {});
    if (err.status) {
      return res.status(err.status).json({
        detail: err.message,
        code: err.code,
        pending_invoices: err.pending_invoices,
        pending_drafts: err.pending_drafts,
      });
    }
    next(err);
  }
};

// GET /api/accounts/daily-closings/:date
export const getDailyClosing = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const closing = await DailyClosing.findOne({
      where: { shop_id: shopId, date: req.params.date },
    });
    if (!closing) {
      return res.status(404).json({ detail: `No daily closing found for ${req.params.date}` });
    }
    return res.json(closing.toJSON());
  } catch (err) {
    next(err);
  }
};

// PUT /api/accounts/daily-closings/:date
export const updateDailyClosing = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const date = req.params.date;
    const shopId = await getDefaultShopId({ transaction: t });
    const existing = await DailyClosing.findOne({
      where: { shop_id: shopId, date },
      transaction: t,
    });
    if (!existing) {
      await t.rollback();
      return res.status(404).json({ detail: `No daily closing found for ${date}` });
    }

    const {
      opening_cash,
      closing_cash,
      cash_received,
      upi_received,
      card_received,
      bank_received,
      notes,
      checklist,
      final_check,
      status,
      use_system_totals = true,
    } = req.body;

    const result = await saveDailyClosing({
      date,
      opening_cash: opening_cash !== undefined ? opening_cash : existing.opening_cash,
      closing_cash: closing_cash !== undefined ? closing_cash : existing.closing_cash,
      cash_received,
      upi_received,
      card_received,
      bank_received,
      notes: notes !== undefined ? notes : existing.notes,
      checklist,
      final_check,
      status: status || existing.status,
      userId: req.user?.id || null,
      forceSystemTotals: use_system_totals !== false,
      includeHidden: includeHiddenFromReq(req),
      transaction: t,
    });

    await t.commit();
    return res.json(result.closing);
  } catch (err) {
    await t.rollback().catch(() => {});
    if (err.status) {
      return res.status(err.status).json({
        detail: err.message,
        code: err.code,
        pending_invoices: err.pending_invoices,
        pending_drafts: err.pending_drafts,
      });
    }
    next(err);
  }
};

// POST /api/accounts/daily-closings/:date/close — finalize EOD
export const closeDailyClosing = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const date = req.params.date;
    const {
      opening_cash,
      closing_cash,
      notes,
      checklist,
      use_system_totals = true,
    } = req.body || {};

    const result = await saveDailyClosing({
      date,
      opening_cash,
      closing_cash,
      notes,
      checklist,
      final_check: req.body?.final_check,
      status: 'closed',
      userId: req.user?.id || null,
      forceSystemTotals: use_system_totals !== false,
      includeHidden: includeHiddenFromReq(req),
      transaction: t,
    });

    await t.commit();
    return res.json({ ...result.closing, snapshot: result.snapshot });
  } catch (err) {
    await t.rollback().catch(() => {});
    if (err.status) {
      return res.status(err.status).json({
        detail: err.message,
        code: err.code,
        pending_invoices: err.pending_invoices,
        pending_drafts: err.pending_drafts,
      });
    }
    next(err);
  }
};

// GET /api/accounts/expenses
export const listExpenses = async (req, res, next) => {
  try {
    const { from, to, category_id, payment_mode, q } = req.query;
    const where = {};

    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from;
      if (to) where.date[Op.lte] = to;
    }
    // Multi-select filters send a comma-separated list of ids/modes.
    const categoryIds = parseMultiParam(category_id);
    if (categoryIds) where.category_id = { [Op.in]: categoryIds };
    const paymentModes = parseMultiParam(payment_mode);
    if (paymentModes) where.payment_mode = { [Op.in]: paymentModes };
    if (q) {
      where[Op.or] = [
        { description: { [likeOp]: `%${q}%` } },
        { category_name: { [likeOp]: `%${q}%` } },
        { reference: { [likeOp]: `%${q}%` } },
      ];
    }

    const shopId = await getDefaultShopId();
    const liveWhere = await withLiveFinancialRecords(shopId, where);
    const expenses = await Expense.findAll({
      where: liveWhere,
      order: [['date', 'DESC'], ['created_at', 'DESC']],
    });

    return res.json(expenses.map((e) => e.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts/expenses
export const createExpense = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      category_id,
      category_name,
      description,
      amount,
      payment_mode = 'cash',
      reference,
      time,
      notes,
    } = req.body;
    let { date } = req.body;

    if (!description) {
      await t.rollback();
      return res.status(400).json({ detail: 'description is required' });
    }
    if (amount === undefined || amount === null) {
      await t.rollback();
      return res.status(400).json({ detail: 'amount is required' });
    }
    const shopId = await getDefaultShopId({ transaction: t });
    // The frontend already defaults this to the shop's active transaction date
    // (not the real calendar date), but any other caller (API, import, a future
    // screen) shouldn't silently fall back to the real date either — resolve it
    // server-side the same way every other transaction in the app does.
    if (!date) {
      date = (await getActiveBillingDate({ shopId, transaction: t })).date;
    }
    if (time != null && time !== '' && !/^\d{2}:\d{2}$/.test(time)) {
      await t.rollback();
      return res.status(400).json({ detail: 'time must be HH:MM' });
    }

    // Detect duplicate UPI / bank / cheque entries by reference on the same date
    if (reference && ['upi', 'bank_transfer', 'bank', 'cheque'].includes(payment_mode)) {
      const modes =
        payment_mode === 'bank' || payment_mode === 'bank_transfer'
          ? ['bank', 'bank_transfer']
          : [payment_mode];
      const dup = await Expense.findOne({
        where: { date, payment_mode: { [Op.in]: modes }, reference },
        transaction: t,
      });
      if (dup) {
        await t.rollback();
        return res.status(409).json({
          detail: `Duplicate reference "${reference}" already recorded for ${payment_mode} on ${date} (Expense ID: ${dup.id}).`,
          duplicate_id: dup.id,
        });
      }
    }

    const expenseId = newId();
    const expense = await Expense.create({
      id: expenseId,
      shop_id: shopId,
      category_id: category_id || null,
      category_name: category_name || null,
      description,
      amount,
      payment_mode,
      reference: reference || null,
      date,
      time: time || currentTimeHHMM(),
      notes: notes || null,
      created_by: req.user?.id || null,
    }, { transaction: t });

    const { postExpenseJournal } = await import('../services/ledgerService.js');
    await postExpenseJournal({
      shopId,
      expenseId,
      amount,
      mode: payment_mode,
      entryDate: date,
      requestId: `expense-jrnl:${expenseId}`,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json(expense.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/accounts/expenses/:id
export const updateExpense = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const expense = await Expense.findByPk(req.params.id, { transaction: t });
    if (!expense) {
      await t.rollback();
      return res.status(404).json({ detail: 'Expense not found' });
    }

    const {
      category_id,
      category_name,
      description,
      amount,
      payment_mode,
      reference,
      date,
      time,
      notes,
    } = req.body;

    if (time != null && time !== '' && !/^\d{2}:\d{2}$/.test(time)) {
      await t.rollback();
      return res.status(400).json({ detail: 'time must be HH:MM' });
    }

    const updates = {};
    if (category_id !== undefined) updates.category_id = category_id;
    if (category_name !== undefined) updates.category_name = category_name;
    if (description !== undefined) updates.description = description;
    if (amount !== undefined) updates.amount = amount;
    if (payment_mode !== undefined) updates.payment_mode = payment_mode;
    if (reference !== undefined) updates.reference = reference;
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time || null;
    if (notes !== undefined) updates.notes = notes;

    const moneyChanged = amount !== undefined || payment_mode !== undefined || date !== undefined;
    const shopId = expense.shop_id || await getDefaultShopId({ transaction: t });

    if (moneyChanged) {
      const { JournalEntry } = await import('../models/index.js');
      const { reverseJournalEntry, postExpenseJournal } = await import('../services/ledgerService.js');
      const prior = await JournalEntry.findOne({
        where: { source_type: 'expense', source_id: expense.id },
        order: [['created_at', 'DESC']],
        transaction: t,
      });
      if (prior && !String(prior.source_type).startsWith('reverse_')) {
        await reverseJournalEntry(prior, {
          requestId: `expense-rev:${expense.id}:${prior.id}`,
          userId: req.user?.id || null,
          transaction: t,
          entryDate: date || expense.date,
        });
      }
      await expense.update(updates, { transaction: t });
      await postExpenseJournal({
        shopId,
        expenseId: expense.id,
        amount: expense.amount,
        mode: expense.payment_mode,
        entryDate: expense.date,
        requestId: `expense-jrnl:${expense.id}:${Date.now()}`,
        userId: req.user?.id || null,
        transaction: t,
      });
    } else {
      await expense.update(updates, { transaction: t });
    }

    await t.commit();
    return res.json(expense.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// DELETE /api/accounts/expenses/:id
export const deleteExpense = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const expense = await Expense.findByPk(req.params.id, { transaction: t });
    if (!expense) {
      await t.rollback();
      return res.status(404).json({ detail: 'Expense not found' });
    }

    const { JournalEntry } = await import('../models/index.js');
    const { reverseJournalEntry } = await import('../services/ledgerService.js');
    const priors = await JournalEntry.findAll({
      where: { source_type: 'expense', source_id: expense.id },
      transaction: t,
    });
    for (const prior of priors) {
      await reverseJournalEntry(prior, {
        requestId: `expense-del-rev:${expense.id}:${prior.id}`,
        userId: req.user?.id || null,
        transaction: t,
        entryDate: expense.date,
      });
    }

    await expense.destroy({ transaction: t });
    await t.commit();
    return res.json({ detail: 'Expense deleted' });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/accounts/incomes
export const listIncomes = async (req, res, next) => {
  try {
    const { from, to, payment_mode, q } = req.query;
    const where = {};

    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from;
      if (to) where.date[Op.lte] = to;
    }
    const paymentModes = parseMultiParam(payment_mode);
    if (paymentModes) where.payment_mode = { [Op.in]: paymentModes };
    if (q) {
      where[Op.or] = [
        { description: { [likeOp]: `%${q}%` } },
        { reference: { [likeOp]: `%${q}%` } },
      ];
    }

    const shopId = await getDefaultShopId();
    const liveWhere = await withLiveFinancialRecords(shopId, where);
    const incomes = await Income.findAll({
      where: liveWhere,
      order: [['date', 'DESC'], ['created_at', 'DESC']],
    });

    return res.json(incomes.map((i) => i.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts/incomes
export const createIncome = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      description,
      amount,
      payment_mode = 'cash',
      reference,
      time,
      notes,
    } = req.body;
    let { date } = req.body;

    if (!description) {
      await t.rollback();
      return res.status(400).json({ detail: 'description is required' });
    }
    if (amount === undefined || amount === null) {
      await t.rollback();
      return res.status(400).json({ detail: 'amount is required' });
    }
    const shopId = await getDefaultShopId({ transaction: t });
    // The frontend already defaults this to the shop's active transaction date
    // (not the real calendar date), but any other caller (API, import, a future
    // screen) shouldn't silently fall back to the real date either — resolve it
    // server-side the same way every other transaction in the app does.
    if (!date) {
      date = (await getActiveBillingDate({ shopId, transaction: t })).date;
    }
    if (time != null && time !== '' && !/^\d{2}:\d{2}$/.test(time)) {
      await t.rollback();
      return res.status(400).json({ detail: 'time must be HH:MM' });
    }

    // Detect duplicate UPI / bank / cheque entries by reference on the same date
    if (reference && ['upi', 'bank_transfer', 'bank', 'cheque'].includes(payment_mode)) {
      const modes =
        payment_mode === 'bank' || payment_mode === 'bank_transfer'
          ? ['bank', 'bank_transfer']
          : [payment_mode];
      const dup = await Income.findOne({
        where: { date, payment_mode: { [Op.in]: modes }, reference },
        transaction: t,
      });
      if (dup) {
        await t.rollback();
        return res.status(409).json({
          detail: `Duplicate reference "${reference}" already recorded for ${payment_mode} on ${date} (Income ID: ${dup.id}).`,
          duplicate_id: dup.id,
        });
      }
    }

    const incomeId = newId();
    const income = await Income.create({
      id: incomeId,
      shop_id: shopId,
      description,
      amount,
      payment_mode,
      reference: reference || null,
      date,
      time: time || currentTimeHHMM(),
      notes: notes || null,
      created_by: req.user?.id || null,
    }, { transaction: t });

    const { postIncomeJournal } = await import('../services/ledgerService.js');
    await postIncomeJournal({
      shopId,
      incomeId,
      amount,
      mode: payment_mode,
      memo: `Income: ${description}`,
      entryDate: date,
      requestId: `income-jrnl:${incomeId}`,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json(income.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/accounts/incomes/:id
export const updateIncome = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const income = await Income.findByPk(req.params.id, { transaction: t });
    if (!income) {
      await t.rollback();
      return res.status(404).json({ detail: 'Income not found' });
    }

    const {
      description,
      amount,
      payment_mode,
      reference,
      date,
      time,
      notes,
    } = req.body;

    if (time != null && time !== '' && !/^\d{2}:\d{2}$/.test(time)) {
      await t.rollback();
      return res.status(400).json({ detail: 'time must be HH:MM' });
    }

    const updates = {};
    if (description !== undefined) updates.description = description;
    if (amount !== undefined) updates.amount = amount;
    if (payment_mode !== undefined) updates.payment_mode = payment_mode;
    if (reference !== undefined) updates.reference = reference;
    if (date !== undefined) updates.date = date;
    if (time !== undefined) updates.time = time || null;
    if (notes !== undefined) updates.notes = notes;

    const moneyChanged = amount !== undefined || payment_mode !== undefined || date !== undefined;
    const shopId = income.shop_id || await getDefaultShopId({ transaction: t });

    if (moneyChanged) {
      const { JournalEntry } = await import('../models/index.js');
      const { reverseJournalEntry, postIncomeJournal } = await import('../services/ledgerService.js');
      const prior = await JournalEntry.findOne({
        where: { source_type: 'income', source_id: income.id },
        order: [['created_at', 'DESC']],
        transaction: t,
      });
      if (prior && !String(prior.source_type).startsWith('reverse_')) {
        await reverseJournalEntry(prior, {
          requestId: `income-rev:${income.id}:${prior.id}`,
          userId: req.user?.id || null,
          transaction: t,
          entryDate: date || income.date,
        });
      }
      await income.update(updates, { transaction: t });
      await postIncomeJournal({
        shopId,
        incomeId: income.id,
        amount: income.amount,
        mode: income.payment_mode,
        memo: `Income: ${income.description}`,
        entryDate: income.date,
        requestId: `income-jrnl:${income.id}:${Date.now()}`,
        userId: req.user?.id || null,
        transaction: t,
      });
    } else {
      await income.update(updates, { transaction: t });
    }

    await t.commit();
    return res.json(income.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// DELETE /api/accounts/incomes/:id
export const deleteIncome = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const income = await Income.findByPk(req.params.id, { transaction: t });
    if (!income) {
      await t.rollback();
      return res.status(404).json({ detail: 'Income not found' });
    }

    const { JournalEntry } = await import('../models/index.js');
    const { reverseJournalEntry } = await import('../services/ledgerService.js');
    const priors = await JournalEntry.findAll({
      where: { source_type: 'income', source_id: income.id },
      transaction: t,
    });
    for (const prior of priors) {
      await reverseJournalEntry(prior, {
        requestId: `income-del-rev:${income.id}:${prior.id}`,
        userId: req.user?.id || null,
        transaction: t,
        entryDate: income.date,
      });
    }

    await income.destroy({ transaction: t });
    await t.commit();
    return res.json({ detail: 'Income deleted' });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// GET /api/accounts/expense-categories
export const listExpenseCategories = async (req, res, next) => {
  try {
    const categories = await ExpenseCategory.findAll({ order: [['name', 'ASC']] });
    return res.json(categories.map((c) => c.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts/expense-categories
export const createExpenseCategory = async (req, res, next) => {
  try {
    const { name, description, icon, color = '#737373' } = req.body;
    if (!name) return res.status(400).json({ detail: 'name is required' });

    const category = await ExpenseCategory.create({
      id: newId(),
      name,
      description: description || null,
      icon: icon || null,
      color,
    });

    return res.status(201).json(category.toJSON());
  } catch (err) {
    next(err);
  }
};

// PUT /api/accounts/expense-categories/:id
export const updateExpenseCategory = async (req, res, next) => {
  try {
    const category = await ExpenseCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ detail: 'Expense category not found' });

    const { name, description, icon, color } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (color !== undefined) updates.color = color;

    await category.update(updates);
    return res.json(category.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/accounts/expense-categories/:id
export const deleteExpenseCategory = async (req, res, next) => {
  try {
    const category = await ExpenseCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ detail: 'Expense category not found' });

    await category.destroy();
    return res.json({ detail: 'Expense category deleted' });
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/ledger
export const getLedger = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ detail: 'Both from and to query params are required' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ detail: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    if (from > to) {
      return res.status(400).json({ detail: 'from must be before or equal to to' });
    }

    const shopId = await getDefaultShopId();
    const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'void', 'voided', 'returned']);

    const invoices = await Invoice.findAll({
      where: {
        [Op.and]: [
          { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] },
          // Business day (Transaction date), not the real created_at timestamp —
          // see invoiceDateRangeWhere.
          invoiceDateRangeWhere({ from, to }),
          ...(includeHiddenFromReq(req)
            ? []
            : [{ [Op.or]: [{ is_hidden: false }, { is_hidden: null }] }]),
          excludePreAccountsWhere(),
        ],
      },
      attributes: ['id', 'grand_total', 'status', 'created_at', 'business_date', 'shop_id', 'is_hidden'],
    });

    const expenses = await Expense.findAll({
      where: {
        date: { [Op.between]: [from, to] },
        [Op.or]: [{ shop_id: shopId }, { shop_id: null }],
        ...excludePreAccountsWhere(),
      },
    });

    const schemes = await Scheme.findAll({
      where: {
        [Op.or]: [{ shop_id: shopId }, { shop_id: null }],
        ...excludePreAccountsWhere(),
      },
      attributes: ['id', 'payments'],
    }).catch(() => []);

    const salesByDay = {};
    for (const inv of invoices) {
      if (isPreAccountsRecord(inv)) continue;
      if (CANCELLED_STATUSES.has(String(inv.status || '').toLowerCase())) continue;
      const key = localDateKey(invoiceOccurredAt(inv) || inv.created_at);
      if (!key || key < from || key > to) continue;
      salesByDay[key] = toMoneyNumber((salesByDay[key] || 0) + toMoneyNumber(inv.grand_total));
    }

    const expensesByDay = {};
    for (const exp of expenses) {
      if (isPreAccountsRecord(exp)) continue;
      const key = localDateKey(exp.date) || String(exp.date).slice(0, 10);
      if (!key || key < from || key > to) continue;
      expensesByDay[key] = toMoneyNumber((expensesByDay[key] || 0) + toMoneyNumber(exp.amount));
    }

    const schemesByDay = {};
    for (const sch of schemes) {
      if (isPreAccountsRecord(sch)) continue;
      const payments = Array.isArray(sch.payments)
        ? sch.payments
        : (typeof sch.payments === 'string'
          ? (() => { try { return JSON.parse(sch.payments); } catch { return []; } })()
          : []);
      for (const p of payments) {
        const key = localDateKey(p.business_date || p.paid_at || p.date || p.created_at);
        if (!key || key < from || key > to) continue;
        schemesByDay[key] = toMoneyNumber((schemesByDay[key] || 0) + toMoneyNumber(p.amount));
      }
    }

    const rows = [];
    const cursor = new Date(`${from}T12:00:00`);
    const endNoon = new Date(`${to}T12:00:00`);
    while (cursor <= endNoon) {
      const dateStr = localDateKey(cursor);
      const daySales = toMoneyNumber(salesByDay[dateStr] || 0);
      const daySchemes = toMoneyNumber(schemesByDay[dateStr] || 0);
      const dayExpenses = toMoneyNumber(expensesByDay[dateStr] || 0);
      rows.push({
        date: dateStr,
        sales: daySales,
        schemes: daySchemes,
        expenses: dayExpenses,
        net: toMoneyNumber(daySales + daySchemes - dayExpenses),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const totals = rows.reduce(
      (acc, row) => ({
        sales: toMoneyNumber(acc.sales + row.sales),
        schemes: toMoneyNumber(acc.schemes + row.schemes),
        expenses: toMoneyNumber(acc.expenses + row.expenses),
        net: toMoneyNumber(acc.net + row.net),
      }),
      { sales: 0, schemes: 0, expenses: 0, net: 0 }
    );

    return res.json({ rows, totals, from, to });
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/summary
export const getAccountsSummary = async (req, res, next) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];
    const snapshot = await buildDaySnapshot(dateStr, { includeHidden: includeHiddenFromReq(req) });
    return res.json({
      date: snapshot.date,
      total_sales: snapshot.totals.sales,
      total_expenses: snapshot.totals.expenses,
      net: toMoneyNumber(snapshot.totals.sales - snapshot.totals.expenses),
      invoice_count: snapshot.totals.invoice_count,
      expense_count: snapshot.totals.expense_count,
      payment_breakdown: snapshot.payment_breakdown,
      cash_summary: {
        opening_cash: snapshot.cash_summary.opening_cash,
        cash_sales: snapshot.cash_summary.cash_sales,
        cash_schemes: snapshot.cash_summary.cash_schemes,
        cash_expenses: snapshot.cash_summary.cash_expenses,
        net_cash: snapshot.cash_summary.expected_closing_cash,
        closing_cash: snapshot.cash_summary.counted_closing_cash,
        expected_closing_cash: snapshot.cash_summary.expected_closing_cash,
        variance: snapshot.cash_summary.variance,
      },
      daily_closing: snapshot.daily_closing,
      blockers: snapshot.blockers,
      suggested_opening_cash: snapshot.suggested_opening_cash,
      previous_closing_cash: snapshot.previous_closing_cash,
    });
  } catch (err) {
    next(err);
  }
};
