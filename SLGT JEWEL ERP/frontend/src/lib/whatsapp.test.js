/**
 * node --test src/lib/whatsapp.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppUrls } from "./whatsapp.js";

test("builds desktop-app and wa.me URLs from a 10-digit mobile", () => {
  const urls = buildWhatsAppUrls("9876543210", "Happy Birthday");
  assert.equal(urls.phone, "919876543210");
  assert.equal(urls.app, "whatsapp://send?phone=919876543210&text=Happy%20Birthday");
  assert.equal(urls.web, "https://wa.me/919876543210?text=Happy%20Birthday");
});

test("does not double-prefix 91", () => {
  const urls = buildWhatsAppUrls("+91 98765 43210", "Hi");
  assert.equal(urls.phone, "919876543210");
  assert.match(urls.app, /phone=919876543210/);
});

test("returns null for invalid mobiles", () => {
  assert.equal(buildWhatsAppUrls(""), null);
  assert.equal(buildWhatsAppUrls("12345"), null);
});
