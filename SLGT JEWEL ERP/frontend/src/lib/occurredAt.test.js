/**
 * node --test src/lib/occurredAt.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sortByOccurredAtDesc } from "./occurredAt.js";

test("history lists newest transaction date first, not created_at", () => {
  const rows = [
    { invoice_no: "SSJ-1/0081", business_date: "2026-09-14", created_at: "2026-09-16T17:00:00.000Z" },
    { invoice_no: "SSJ-1/0083", business_date: "2026-09-14", created_at: "2026-09-16T17:30:00.000Z" },
    { invoice_no: "SSJ-1/0082", business_date: "2026-09-16", created_at: "2026-09-16T10:00:00.000Z" },
  ];
  assert.deepEqual(
    sortByOccurredAtDesc(rows).map((r) => r.invoice_no),
    ["SSJ-1/0082", "SSJ-1/0083", "SSJ-1/0081"],
  );
});

test("same business day lists highest invoice number first, not earlier clock", () => {
  const rows = [
    { invoice_no: "SSJ-1/0001", business_date: "2026-09-19", created_at: "2026-09-19T14:30:00.000Z" },
    { invoice_no: "SSJ-1/0002", business_date: "2026-09-19", created_at: "2026-09-21T04:51:00.000Z" },
  ];
  assert.deepEqual(
    sortByOccurredAtDesc(rows).map((r) => r.invoice_no),
    ["SSJ-1/0002", "SSJ-1/0001"],
  );
});
