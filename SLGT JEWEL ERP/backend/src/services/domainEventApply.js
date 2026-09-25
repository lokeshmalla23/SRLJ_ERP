/**
 * Apply a single event_log row to domain tables (idempotent).
 */
import {
  Invoice, Product, Customer, User, Setting, Category, Vendor, Employee,
  Quotation, Scheme, InventoryMovement, OperationLedger, DailyClosing, Expense,
  JournalEntry,
} from '../models/index.js';
import { findOperation, recordOperation } from './eventLogService.js';

async function upsertById(Model, row, transaction) {
  if (!row?.id) return;
  const existing = await Model.findByPk(row.id, { transaction });
  if (existing) {
    await existing.update(row, { transaction });
  } else {
    await Model.create(row, { transaction });
  }
}

export async function applyDomainEvent(ev, { transaction }) {
  if (!ev) return { applied: false };

  if (ev.operation_id) {
    const prior = await findOperation(ev.operation_id);
    if (prior) return { applied: false, idempotent: true };
  }

  const type = ev.event_type;
  const p = ev.payload || {};

  switch (type) {
    case 'INVOICE_CREATED': {
      if (p.invoice) await upsertById(Invoice, p.invoice, transaction);
      for (const m of p.movements || []) await upsertById(InventoryMovement, m, transaction);
      for (const prod of p.products || []) await upsertById(Product, prod, transaction);
      if (p.customer) await upsertById(Customer, p.customer, transaction);
      break;
    }
    case 'INVOICE_VOIDED': {
      if (p.invoice) await upsertById(Invoice, p.invoice, transaction);
      for (const m of p.movements || []) await upsertById(InventoryMovement, m, transaction);
      for (const prod of p.products || []) await upsertById(Product, prod, transaction);
      break;
    }
    case 'PRODUCT_UPSERTED':
    case 'ITEM_SOLD':
    case 'STOCK_ADJUSTED': {
      if (p.product) await upsertById(Product, p.product, transaction);
      for (const m of p.movements || []) await upsertById(InventoryMovement, m, transaction);
      break;
    }
    case 'CUSTOMER_UPSERTED':
    case 'CUSTOMER_UPDATED': {
      if (p.customer) await upsertById(Customer, p.customer, transaction);
      break;
    }
    case 'USER_UPSERTED': {
      if (p.user) {
        const u = { ...p.user };
        await upsertById(User, u, transaction);
      }
      break;
    }
    case 'SETTING_UPSERTED': {
      if (p.setting) await upsertById(Setting, p.setting, transaction);
      break;
    }
    case 'CATEGORY_UPSERTED': {
      if (p.category) await upsertById(Category, p.category, transaction);
      break;
    }
    case 'VENDOR_UPSERTED': {
      if (p.vendor) await upsertById(Vendor, p.vendor, transaction);
      break;
    }
    case 'EMPLOYEE_UPSERTED': {
      if (p.employee) await upsertById(Employee, p.employee, transaction);
      break;
    }
    case 'QUOTATION_UPSERTED': {
      if (p.quotation) await upsertById(Quotation, p.quotation, transaction);
      break;
    }
    case 'SCHEME_UPSERTED':
    case 'SCHEME_PAYMENT': {
      if (p.scheme) await upsertById(Scheme, p.scheme, transaction);
      break;
    }
    case 'DAILY_CLOSING_UPSERTED': {
      if (p.daily_closing) await upsertById(DailyClosing, p.daily_closing, transaction);
      break;
    }
    case 'CASHBOOK_ENTRY': {
      if (p.cashbook_entry) {
        const { CashbookEntry } = await import('../models/index.js');
        await upsertById(CashbookEntry, p.cashbook_entry, transaction);
      }
      break;
    }
    case 'JOURNAL_POSTED': {
      if (p.journal_entry) await upsertById(JournalEntry, p.journal_entry, transaction);
      break;
    }
    case 'EXPENSE_UPSERTED': {
      if (p.expense) await upsertById(Expense, p.expense, transaction);
      break;
    }
    case 'ENTITY_UPSERT': {
      // Generic fallback: payload.model + payload.row
      break;
    }
    default:
      // Unknown events still advance watermark; domain may ignore
      break;
  }

  if (ev.operation_id) {
    try {
      await recordOperation({
        operationId: ev.operation_id,
        operationType: type,
        entityType: ev.entity_type,
        entityId: ev.entity_id,
        result: { applied_from_event: true, seq: ev.seq },
        deviceId: ev.origin_device_id,
        userId: ev.user_id,
        transaction,
      });
    } catch { /* duplicate ok */ }
  }

  return { applied: true };
}
