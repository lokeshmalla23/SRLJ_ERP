/**
 * Legacy gate: do not attach this to POS billing or estimation.
 * Pre-accounts shops must be allowed to create TEST transactions.
 * Kept only so existing imports do not break.
 */
import {
  assertAccountsSetupCompleted,
  ACCOUNTS_SETUP_REQUIRED,
} from '../services/openingSetupService.js';

export function requireAccountsSetupCompleted(operation = 'pos') {
  return async (req, res, next) => {
    try {
      await assertAccountsSetupCompleted({
        shopId: req.user?.shop_id || null,
        operation,
      });
      next();
    } catch (err) {
      if (err?.code === ACCOUNTS_SETUP_REQUIRED || err?.name === 'AccountsSetupError') {
        return res.status(err.status || 403).json({
          detail: err.message,
          code: ACCOUNTS_SETUP_REQUIRED,
        });
      }
      next(err);
    }
  };
}
