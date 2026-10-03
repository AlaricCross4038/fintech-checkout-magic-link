import { createHmac, timingSafeEqual } from "node:crypto";
import { InfraiClient } from "./infrai_client.js";
import { decideSignin, type PaymentEvent, type RiskContext } from "./signin_policy.js";

type PendingLink = {
  userId: string;
  eventId: string;
  email: string;
  expiresAt: number;
  used: boolean;
};

export type LinkRequest = {
  requestId: string;
  userId: string;
  email: string;
  paymentEvent: PaymentEvent;
  risk: RiskContext;
};

export type AuditReceipt = {
  requestId: string;
  eventId: string;
  decision: "allow";
  reason: string;
  messageId: string;
  recordedAt: string;
};

export class SigninRejected extends Error {
  readonly outcome: "review" | "deny";
  readonly reason: string;

  constructor(outcome: "review" | "deny", reason: string) {
    super(`Sign-in ${outcome}: ${reason}`);
    this.outcome = outcome;
    this.reason = reason;
  }
}

export class MagicLinkService {
  private readonly pending = new Map<string, PendingLink>();
  private readonly receipts = new Map<string, AuditReceipt>();
  private readonly gateway: InfraiClient;
  private readonly secret: string;
  private readonly publicBaseUrl: string;
  private readonly now: () => number;

  constructor(
    gateway: InfraiClient,
    secret: string,
    publicBaseUrl: string,
    now: () => number = Date.now,
  ) {
    this.gateway = gateway;
    this.secret = secret;
    this.publicBaseUrl = publicBaseUrl;
    this.now = now;
  }

  async requestLink(input: LinkRequest): Promise<AuditReceipt> {
    const previous = this.receipts.get(input.requestId);
    if (previous) return previous;

    const decision = decideSignin(input.paymentEvent, input.risk);
    if (decision.outcome !== "allow") {
      this.writeAudit({
        requestId: input.requestId,
        eventId: input.paymentEvent.eventId,
        decision: decision.outcome,
        reason: decision.reason,
        recordedAt: new Date(this.now()).toISOString(),
      });
      throw new SigninRejected(decision.outcome, decision.reason);
    }

    const expiresAt = this.now() + 10 * 60 * 1_000;
    const payload = Buffer.from(JSON.stringify({
      requestId: input.requestId,
      userId: input.userId,
      eventId: input.paymentEvent.eventId,
      expiresAt,
    })).toString("base64url");
    const signature = this.sign(payload);
    const token = `${payload}.${signature}`;
    const link = `${this.publicBaseUrl}/signin/redeem?token=${encodeURIComponent(token)}`;

    this.pending.set(input.requestId, {
      userId: input.userId,
      eventId: input.paymentEvent.eventId,
      email: input.email,
      expiresAt,
      used: false,
    });

    const sent = await this.gateway.sendSigninLink({
      to: input.email,
      subject: `Approve sign-in for payment ${input.paymentEvent.eventId}`,
      html: `<p>Use this sign-in link to continue checkout:</p><p><a href="${link}">Continue securely</a></p><p>This link expires in 10 minutes.</p>`,
    });
    const receipt: AuditReceipt = {
      requestId: input.requestId,
      eventId: input.paymentEvent.eventId,
      decision: "allow",
      reason: decision.reason,
      messageId: sent.message_id,
      recordedAt: new Date(this.now()).toISOString(),
    };
    this.receipts.set(input.requestId, receipt);
    this.writeAudit(receipt);
    return receipt;
  }

  async redeem(token: string): Promise<{ eventId: string; session: Record<string, unknown> }> {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !this.signatureMatches(payload, signature)) {
      throw new SigninRejected("deny", "invalid_link");
    }

    let claims: { requestId: string; userId: string; eventId: string; expiresAt: number };
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof claims;
    } catch {
      throw new SigninRejected("deny", "invalid_link");
    }
    const pending = this.pending.get(claims.requestId);
    if (!pending || pending.used || pending.userId !== claims.userId || pending.eventId !== claims.eventId) {
      throw new SigninRejected("deny", "invalid_link");
    }
    if (claims.expiresAt !== pending.expiresAt || this.now() > pending.expiresAt) {
      throw new SigninRejected("deny", "expired_link");
    }

    pending.used = true;
    let session: Record<string, unknown>;
    try {
      session = await this.gateway.createSession(claims.userId);
    } catch (error) {
      pending.used = false;
      throw error;
    }
    this.writeAudit({ eventId: claims.eventId, requestId: claims.requestId, decision: "session_created", recordedAt: new Date(this.now()).toISOString() });
    return { eventId: claims.eventId, session };
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private signatureMatches(payload: string, supplied: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(supplied);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private writeAudit(event: Record<string, unknown>): void {
    console.log(JSON.stringify({ type: "checkout_signin_audit", ...event }));
  }
}
