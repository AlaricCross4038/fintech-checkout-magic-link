import assert from "node:assert/strict";
import test from "node:test";
import { decideSignin } from "../src/signin_policy.js";

test("allows a familiar-device checkout with a low risk score", () => {
  const decision = decideSignin(
    { eventId: "payment_1042", type: "checkout_payment_authorized", amountMinor: 12900, currency: "USD" },
    { score: 18, newDevice: false },
  );
  assert.deepEqual(decision, { outcome: "allow", reason: "routine_checkout" });
});

test("holds a payout destination change for review", () => {
  const decision = decideSignin(
    { eventId: "payout_88", type: "payout_destination_changed", amountMinor: 0, currency: "USD" },
    { score: 12, newDevice: false },
  );
  assert.deepEqual(decision, { outcome: "review", reason: "sensitive_action" });
});

test("denies any action at a high risk score", () => {
  const decision = decideSignin(
    { eventId: "refund_15", type: "refund_requested", amountMinor: 1500, currency: "USD" },
    { score: 86, newDevice: false },
  );
  assert.deepEqual(decision, { outcome: "deny", reason: "high_risk" });
});
