/**
 * Profit & Loss feature gate — the Application Management `profit_loss`
 * toggle is the single authority for every client-facing profitability
 * figure (P&L statement, gross/net profit, margins, Balance Sheet retained
 * earnings). When OFF the endpoint is refused server-side so hiding the UI
 * is never the only protection.
 *
 * Defaults to OFF (see resolveProfitLossMode). Underlying COGS postings and
 * stock valuation are NOT affected — only the profitability read APIs.
 */
import { getProfitLossMode } from '../services/profitLossMode.js';

export const PROFIT_LOSS_DISABLED_CODE = 'PROFIT_LOSS_DISABLED';

export async function requireProfitLossEnabled(req, res, next) {
  try {
    const { enabled } = await getProfitLossMode();
    if (!enabled) {
      return res.status(403).json({
        detail: 'Profit & Loss is turned off for this shop (Settings → Application Management).',
        code: PROFIT_LOSS_DISABLED_CODE,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}
