import {
  listFinancialYears,
  getCurrentFinancialYear,
  ensureCurrentFinancialYear,
  closeFinancialYear,
  reopenFinancialYear,
  fyCodeForDate,
  fyRangeForDate,
  fyDisplayName,
} from '../services/financialYearService.js';

// GET /api/financial-years — list (any authenticated user with accounts view)
export const listFinancialYearsHandler = async (req, res, next) => {
  try {
    const rows = await listFinancialYears(req.user?.shop_id || null);
    return res.json(rows.map((fy) => fy.toJSON()));
  } catch (err) {
    next(err);
  }
};

// GET /api/financial-years/current — the current FY (from business date)
export const getCurrentFinancialYearHandler = async (req, res, next) => {
  try {
    const fy = await getCurrentFinancialYear(req.user?.shop_id || null);
    if (!fy) return res.status(404).json({ detail: 'No financial year resolved for the current business date' });
    return res.json(fy.toJSON());
  } catch (err) {
    next(err);
  }
};

// GET /api/financial-years/resolve?date=YYYY-MM-DD — resolve FY for a date
export const resolveFinancialYearHandler = async (req, res, next) => {
  try {
    const { date } = req.query;
    const code = fyCodeForDate(date);
    if (!code) return res.status(400).json({ detail: 'date (YYYY-MM-DD) is required' });
    const range = fyRangeForDate(date);
    return res.json({
      financial_year_code: code,
      display_name: fyDisplayName(code),
      start_date: range.start_date,
      end_date: range.end_date,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/financial-years/ensure-current — startup/business-date advance hook
export const ensureCurrentFinancialYearHandler = async (req, res, next) => {
  try {
    const fy = await ensureCurrentFinancialYear(req.user?.shop_id || null);
    return res.json(fy ? fy.toJSON() : { detail: 'no current business date' });
  } catch (err) {
    next(err);
  }
};

// POST /api/financial-years/:id/close — elevated accounting/admin permission
export const closeFinancialYearHandler = async (req, res, next) => {
  try {
    const result = await closeFinancialYear(req.params.id, { userId: req.user?.id || null });
    return res.json({ ...result, financial_year: result.financialYear.toJSON() });
  } catch (err) {
    next(err);
  }
};

// POST /api/financial-years/:id/reopen — elevated accounting/admin permission
export const reopenFinancialYearHandler = async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const result = await reopenFinancialYear(req.params.id, { userId: req.user?.id || null, reason });
    return res.json({ ...result, financial_year: result.financialYear.toJSON() });
  } catch (err) {
    next(err);
  }
};
