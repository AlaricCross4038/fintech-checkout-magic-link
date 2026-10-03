export type PaymentEvent = {
  eventId: string;
  type: "checkout_payment_authorized" | "refund_requested" | "payout_destination_changed";
  amountMinor: number;
  currency: string;
};

export type RiskContext = {
  score: number;
  newDevice: boolean;
};

export type SigninDecision =
  | { outcome: "allow"; reason: "routine_checkout" }
  | { outcome: "review"; reason: "sensitive_action" | "elevated_risk" }
  | { outcome: "deny"; reason: "high_risk" };

export function decideSignin(event: PaymentEvent, risk: RiskContext): SigninDecision {
  if (risk.score >= 80) return { outcome: "deny", reason: "high_risk" };

  const changesMoneyDestination = event.type === "payout_destination_changed";
  const largeRefund = event.type === "refund_requested" && event.amountMinor >= 50_000;
  if (changesMoneyDestination || largeRefund) {
    return { outcome: "review", reason: "sensitive_action" };
  }
  if (risk.score >= 50 || risk.newDevice) {
    return { outcome: "review", reason: "elevated_risk" };
  }
  return { outcome: "allow", reason: "routine_checkout" };
}
