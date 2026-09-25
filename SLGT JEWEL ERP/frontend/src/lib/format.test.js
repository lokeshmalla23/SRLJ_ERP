import test from "node:test";
import assert from "node:assert/strict";
import {
  fmtINR,
  fmtINRPlain,
  formatMoneyInput,
  parseMoneyInput,
} from "./format.js";
import {
  cursorForTokenCount,
  cursorTokenCount,
  sanitizeMoneyDraft,
} from "./moneyInput.js";

test("formats rupees with Indian lakh and crore grouping", () => {
  assert.equal(fmtINR(0), "₹0.00");
  assert.equal(fmtINR(999), "₹999.00");
  assert.equal(fmtINR(1000), "₹1,000.00");
  assert.equal(fmtINR(99999), "₹99,999.00");
  assert.equal(fmtINR(100000), "₹1,00,000.00");
  assert.equal(fmtINR(1234567.89), "₹12,34,567.89");
  assert.equal(fmtINR(10000000), "₹1,00,00,000.00");
  assert.equal(fmtINR(-123456.7), "-₹1,23,456.70");
});

test("formats and parses editable money without leaking grouping", () => {
  assert.equal(formatMoneyInput("123456789.5"), "12,34,56,789.5");
  assert.equal(formatMoneyInput("1000."), "1,000.");
  assert.equal(fmtINRPlain(1234567.8), "12,34,567.80");
  assert.equal(parseMoneyInput("₹12,34,567.89"), 1234567.89);
  assert.equal(sanitizeMoneyDraft("1,23,456.789"), "123456.78");
  assert.equal(sanitizeMoneyDraft("-1,234.50", { allowNegative: true }), "-1234.50");
});

test("maps a caret by numeric token position after grouping", () => {
  const before = "12345";
  const after = "12,345";
  const token = cursorTokenCount(before, 3);
  assert.equal(token, 3);
  assert.equal(cursorForTokenCount(after, token), 4);
});
