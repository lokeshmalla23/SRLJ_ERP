/**
 * Auto Day Close — when Close Day is turned OFF (Settings → Application
 * Management), closes every past business day automatically: no checklist,
 * no pending-invoice / draft checks, counted cash = expected cash. Runs on a
 * timer after midnight and at startup (catches up days missed while the PC
 * was off), one day per transaction, oldest first.
 */
import sequelize from '../db.js';
import { isBranchMode } from '../config/appMode.js';
import branchConfig from '../config/branchConfig.js';
import { logger } from '../utils/logger.js';
import { getDefaultShopId } from './defaultShop.js';
import { getAutoDayCloseMode } from './autoDayCloseMode.js';
import {
  advanceActiveBillingDate,
  localTodayStr,
  readStoredBillingDate,
  saveDailyClosing,
  setActiveBillingDate,
} from './dailyClosingService.js';
import { goLiveForAutoDayClose } from './openingSetupService.js';
import { DailyClosing } from '../models/index.js';
import { broadcast } from './wsServer.js';

// Safety cap per run — a longer gap simply continues on the next tick.
const MAX_DAYS_PER_RUN = 60;

let running = null;

async function closeOneDay(shopId, date, userId) {
  await sequelize.transaction(async (t) => {
    const existing = await DailyClosing.findOne({ where: { shop_id: shopId, date }, transaction: t });
    if (existing?.status === 'closed') {
      await advanceActiveBillingDate({ shopId, closedDate: date, transaction: t });
      return;
    }
    await saveDailyClosing({
      date,
      status: 'closed',
      autoClose: true,
      checklist: { auto_closed: true },
      notes: existing?.notes || 'Auto-closed (Close Day turned off)',
      userId,
      transaction: t,
    });
  });
}

async function run({ userId = null } = {}) {
  // LAN client PCs receive closings by replication from the active host.
  if (isBranchMode() && branchConfig.role !== 'active_host') return { skipped: 'not_host' };
  if (!(await getAutoDayCloseMode()).enabled) return { skipped: 'manual_mode' };

  const shopId = await getDefaultShopId();
  const today = localTodayStr();
  const goLive = await goLiveForAutoDayClose({ shopId, today, userId });

  let pointer = await readStoredBillingDate();
  if (!pointer) {
    await setActiveBillingDate({ shopId, date: today });
    pointer = today;
  }

  const closed = [];
  while (pointer < today && closed.length < MAX_DAYS_PER_RUN) {
    await closeOneDay(shopId, pointer, userId);
    closed.push(pointer);
    const next = await readStoredBillingDate();
    if (!next || next <= pointer) break; // pointer did not advance — stop, retry next tick
    pointer = next;
  }

  if (closed.length) {
    logger.info('accounts', 'auto day close', { closed });
    try { broadcast({ type: 'accounts:auto_day_closed', dates: closed }); } catch { /* ws not available */ }
  }
  return { closed, went_live: goLive && !goLive.skipped };
}

/** Single-flight: concurrent callers share the in-progress run. */
export function runAutoDayClose(opts) {
  if (!running) {
    running = run(opts).finally(() => { running = null; });
  }
  return running;
}
