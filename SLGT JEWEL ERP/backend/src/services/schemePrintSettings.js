/**
 * Settings → Scheme: independent field checklists for the three scheme
 * documents. Stored under the Setting key `scheme_print` via the existing
 * key/value settings store. The catalog below is the single source of truth
 * for which fields exist — the frontend renders its checklist from it.
 */
import { asObject } from './settingsStore.js';

export const SCHEME_PRINT_SETTING_KEY = 'scheme_print';

const HEADER = [
  { key: 'header', label: 'Header', group: 'Company' },
  { key: 'company_logo', label: 'Company Logo', group: 'Company' },
  { key: 'company_name', label: 'Company Name', group: 'Company' },
  { key: 'company_address', label: 'Address', group: 'Company' },
  { key: 'company_phone', label: 'Phone', group: 'Company' },
  { key: 'company_email', label: 'Email', group: 'Company', default: false },
  { key: 'company_gst', label: 'GSTIN', group: 'Company' },
];
const CUSTOMER = [
  { key: 'customer_name', label: 'Customer Name', group: 'Customer' },
  { key: 'customer_phone', label: 'Customer Phone', group: 'Customer' },
  { key: 'customer_address', label: 'Customer Address', group: 'Customer', default: false },
  { key: 'customer_serial', label: 'Customer S.No', group: 'Customer', default: false },
];
const SCHEME = [
  { key: 'scheme_number', label: 'Scheme Number', group: 'Scheme' },
  { key: 'scheme_name', label: 'Scheme / Plan Name', group: 'Scheme' },
  { key: 'scheme_type', label: 'Scheme Type (Cash / Gold)', group: 'Scheme' },
  { key: 'start_date', label: 'Start Date', group: 'Dates' },
  { key: 'maturity_date', label: 'Maturity Date', group: 'Dates' },
  { key: 'duration', label: 'Duration (months)', group: 'Scheme' },
  { key: 'installment_amount', label: 'Installment Amount', group: 'Amounts' },
  { key: 'total_amount', label: 'Total Amount', group: 'Amounts' },
  { key: 'maturity_value', label: 'Maturity Value (incl. bonus)', group: 'Amounts' },
];
const PEOPLE = [
  { key: 'created_by', label: 'Created By (Enrolled Employee)', group: 'Staff' },
  { key: 'employee_phone', label: 'Employee Phone', group: 'Staff' },
];
const FOOTER = [
  { key: 'notes', label: 'Scheme Notes', group: 'Other', default: false },
  { key: 'signatures', label: 'Signatures', group: 'Other' },
  { key: 'footer', label: 'Footer', group: 'Other' },
  { key: 'printed_on', label: 'Printed On (date/time)', group: 'Other' },
];

export const SCHEME_PRINT_DOCUMENTS = Object.freeze({
  creation: {
    title: 'Scheme Creation Print',
    description: 'Printed after a scheme is created (Save & Print). A5 only.',
    papers: ['A5'],
    default_paper: 'A5',
    fields: [
      ...HEADER, ...CUSTOMER, ...SCHEME,
      { key: 'status', label: 'Status', group: 'Scheme' },
      ...PEOPLE, ...FOOTER,
    ],
  },
  statement: {
    title: 'Scheme Statement Print',
    description: 'Customer statement with payment summary and every installment. A4 default, A5 optional.',
    papers: ['A4', 'A5'],
    default_paper: 'A4',
    fields: [
      ...HEADER, ...CUSTOMER, ...SCHEME,
      { key: 'status', label: 'Status', group: 'Scheme' },
      ...PEOPLE,
      { key: 'payment_summary', label: 'Payment Summary', group: 'Statement' },
      { key: 'transaction_table', label: 'Transaction Table', group: 'Statement' },
      { key: 'pending_installments_rows', label: 'Pending Installments in Table', group: 'Statement' },
      { key: 'gold_details', label: 'Gold Rate / Grams (gold schemes)', group: 'Statement' },
      { key: 'redemption_details', label: 'Maturity / Redemption Details', group: 'Statement' },
      ...FOOTER,
    ],
  },
  closure: {
    title: 'Scheme Closure Certificate',
    description: 'Issued only when the scheme is closed (Completed / Pre-closed). A5 default.',
    papers: ['A5', 'A4'],
    default_paper: 'A5',
    fields: [
      ...HEADER, ...CUSTOMER, ...SCHEME,
      { key: 'status', label: 'Final Status', group: 'Closure' },
      { key: 'final_totals', label: 'Final Totals', group: 'Closure' },
      { key: 'closure_date', label: 'Closure Date', group: 'Closure' },
      { key: 'closure_reason', label: 'Closure Reason', group: 'Closure' },
      { key: 'redemption_details', label: 'Redemption Details', group: 'Closure' },
      ...PEOPLE, ...FOOTER,
    ],
  },
  payment_receipt: {
    title: 'Payment Receipt',
    description: 'Shown after recording a payment. A5 only.',
    papers: ['A5'],
    default_paper: 'A5',
    fields: [
      ...HEADER,
      { key: 'customer_name', label: 'Customer Name', group: 'Customer' },
      { key: 'customer_id', label: 'Customer ID', group: 'Customer' },
      { key: 'customer_phone', label: 'Mobile Number', group: 'Customer' },
      { key: 'scheme_number', label: 'Scheme No.', group: 'Scheme' },
      { key: 'scheme_name', label: 'Scheme Name', group: 'Scheme' },
      { key: 'start_date', label: 'Enrolled Date', group: 'Dates' },
      { key: 'employee_name', label: 'Employee Name', group: 'Staff' },
      { key: 'employee_phone', label: 'Employee Phone', group: 'Staff' },
      { key: 'payment_history', label: 'Payment History Table', group: 'Receipt' },
      { key: 'gold_details', label: 'Gold Rate / Grams (gold schemes)', group: 'Receipt' },
      ...FOOTER,
    ],
  },
});

export const SCHEME_PRINT_DOC_KEYS = Object.keys(SCHEME_PRINT_DOCUMENTS);

function defaultsFor(doc) {
  const def = SCHEME_PRINT_DOCUMENTS[doc];
  const fields = {};
  for (const f of def.fields) fields[f.key] = f.default !== false;
  return { fields, paper: def.default_paper };
}

/** Effective settings: stored values over defaults, unknown keys dropped. */
export function resolveSchemePrintSettings(stored) {
  const raw = asObject(stored);
  const out = {};
  for (const doc of SCHEME_PRINT_DOC_KEYS) {
    const def = SCHEME_PRINT_DOCUMENTS[doc];
    const base = defaultsFor(doc);
    const saved = asObject(raw[doc]);
    const savedFields = asObject(saved.fields);
    for (const f of def.fields) {
      if (typeof savedFields[f.key] === 'boolean') base.fields[f.key] = savedFields[f.key];
    }
    if (def.papers.includes(saved.paper)) base.paper = saved.paper;
    out[doc] = base;
  }
  return out;
}

/** Validate an incoming patch → sanitized full value to store. */
export function sanitizeSchemePrintPatch(current, patch) {
  const next = resolveSchemePrintSettings(current);
  const body = asObject(patch);
  for (const doc of SCHEME_PRINT_DOC_KEYS) {
    if (!body[doc] || typeof body[doc] !== 'object') continue;
    const def = SCHEME_PRINT_DOCUMENTS[doc];
    const fields = asObject(body[doc].fields);
    for (const f of def.fields) {
      if (typeof fields[f.key] === 'boolean') next[doc].fields[f.key] = fields[f.key];
    }
    if (def.papers.includes(body[doc].paper)) next[doc].paper = body[doc].paper;
  }
  return next;
}

export function schemePrintCatalog() {
  return SCHEME_PRINT_DOC_KEYS.map((doc) => {
    const d = SCHEME_PRINT_DOCUMENTS[doc];
    return {
      id: doc,
      title: d.title,
      description: d.description,
      papers: d.papers,
      default_paper: d.default_paper,
      fields: d.fields.map((f) => ({ key: f.key, label: f.label, group: f.group, default: f.default !== false })),
    };
  });
}
