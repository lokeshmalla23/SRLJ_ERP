import test from "node:test";
import assert from "node:assert/strict";
import { parseWeightInput, roundWeight, sanitizeWeightDraft, formatWeight } from "./weightInput.js";

test("4th digit 0-4 keeps the 3rd; 5-9 rounds the 3rd up", () => {
  assert.equal(roundWeight("1.2356"), 1.236);
  assert.equal(roundWeight("1.2354"), 1.235);
  assert.equal(roundWeight("1.2350"), 1.235);
  assert.equal(roundWeight("1.2351"), 1.235);
  assert.equal(roundWeight("1.2355"), 1.236);
  assert.equal(roundWeight("1.2359"), 1.236);
  assert.equal(roundWeight("1.2344"), 1.234);
  assert.equal(roundWeight("1.2345"), 1.235);
  assert.equal(roundWeight("0.0014"), 0.001);
  assert.equal(roundWeight("0.0015"), 0.002);
  assert.equal(roundWeight("1.9996"), 2);
  assert.equal(roundWeight("12.3"), 12.3);
});

test("formatWeight never shows more than 3 decimal places", () => {
  assert.equal(formatWeight(7.2010000000000005), "7.201");
  assert.equal(formatWeight(6.969000000000001), "6.969");
  assert.equal(formatWeight(9.425 - 2.456), "6.969");
  assert.equal(formatWeight(9.425), "9.425");
  assert.equal(formatWeight(0), "0");
});

test("weight drafts apply the same 4th-digit rule as soon as a 4th digit is typed", () => {
  assert.equal(sanitizeWeightDraft("1.2356"), "1.236");
  assert.equal(sanitizeWeightDraft("1.2354"), "1.235");
  assert.equal(sanitizeWeightDraft("1.2345"), "1.235");
  assert.equal(sanitizeWeightDraft("0.4009"), "0.401");
  assert.equal(sanitizeWeightDraft("12.3"), "12.3");
  assert.equal(sanitizeWeightDraft("12."), "12.");
  assert.equal(parseWeightInput("1.234"), 1.234);
  assert.equal(parseWeightInput(""), 0);
});
