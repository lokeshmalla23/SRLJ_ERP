/**
 * node tests/invoiceVisibility.test.js
 */
import assert from 'assert';
import {
  isHiddenBill,
  isHiddenInvoiceNo,
  wantsHiddenBills,
} from '../src/utils/invoiceVisibility.js';
import { stampOnTransactionDate } from '../src/utils/invoiceRead.js';

assert.strictEqual(isHiddenInvoiceNo('SSJ-H-1/0001'), true);
assert.strictEqual(isHiddenInvoiceNo('SSJ-1/0001'), false);
assert.strictEqual(isHiddenInvoiceNo(null), false);

assert.strictEqual(isHiddenBill({ invoice_no: 'SSJ-H-1/0001', is_hidden: 0 }), true, 'H- prefix is hidden even if flag is 0');
assert.strictEqual(isHiddenBill({ invoice_no: 'SSJ-1/0001', is_hidden: 0 }), false);
assert.strictEqual(isHiddenBill({ invoice_no: 'SSJ-1/0001', is_hidden: 1 }), true);
assert.strictEqual(isHiddenBill({ invoice_no: 'SSJ-1/0001', is_hidden: false }), false);
assert.strictEqual(isHiddenBill({ invoice_no: 'SSJ-1/0001', isHidden: true }), true);

assert.strictEqual(wantsHiddenBills({ include_hidden: 1, _role: 'shop_owner' }), true);
assert.strictEqual(wantsHiddenBills({ include_hidden: 1, _role: 'cashier' }), false);
assert.strictEqual(wantsHiddenBills({ include_hidden: 0, _role: 'shop_owner' }), false);
assert.strictEqual(wantsHiddenBills({ _role: 'shop_owner' }), false);

const stamped = stampOnTransactionDate('2026-09-14', new Date('2026-09-16T16:09:00'));
assert.strictEqual(stamped.getFullYear(), 2026);
assert.strictEqual(stamped.getMonth(), 8);
assert.strictEqual(stamped.getDate(), 14);
assert.strictEqual(stamped.getHours(), 16);
assert.strictEqual(stamped.getMinutes(), 9);

console.log('invoiceVisibility.test.js ok');
