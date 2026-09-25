/**
 * node --test src/lib/trayWeight.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { trayLabelWeights } from "./trayWeight.js";

test("tray label uses edited tray_total_weight, not stale gross/net", () => {
  const w = trayLabelWeights({
    unit_code: "tray",
    tray_total_weight: 35,
    gross_weight: 49,
    net_weight: 49,
  });
  assert.equal(w.gross, 35);
  assert.equal(w.net, 35);
});

test("gram jewellery prints updated gross, net, and stone", () => {
  const w = trayLabelWeights({
    unit_code: "g",
    tray_total_weight: 0,
    gross_weight: 8.25,
    net_weight: 7.1,
    stone_weight: 1.15,
  });
  assert.equal(w.gross, 8.25);
  assert.equal(w.net, 7.1);
  assert.equal(w.stone, 1.15);
});

test("gram jewellery still prints its own gross/net", () => {
  const w = trayLabelWeights({
    unit_code: "g",
    tray_total_weight: 0,
    gross_weight: 12.45,
    net_weight: 11.2,
  });
  assert.equal(w.gross, 12.45);
  assert.equal(w.net, 11.2);
});
