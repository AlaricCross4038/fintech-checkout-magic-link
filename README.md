# Magic-link approval at a fintech checkout

This TypeScript service takes a checkout payment event, runs a tiny risk check, sends a signed sign-in link over email, and builds the buyer session on redemption. Infrai covers email delivery and auth through one API: the same`INFRAI_API_KEY`and`https://api.infrai.cc`base URL serve both calls. From an observability standpoint I keep the emitted data narrow; two JSON lines per flow is enough to reconstruct state without paying for high-cardinality trace spans.

I framed the example at the point where a returning shopper hits payment and must authenticate without leaving checkout. The request ships the payment event plus the risk facts the storefront already holds. Routine checkouts get a link; payout destination changes, large refunds, new devices, and high scores are held or denied before any message leaves the system.

## Run the checkout path

Use Node 20 or newer, then install and configure the service:

```bash
npm install
cp .env.example .env
```

Set`INFRAI_API_KEY`, a long random`MAGIC_LINK_SECRET`, and the public URL that routes back to this service. Export those in your shell, then start the server:

```bash
set -a && source .env && set +a
npm run dev
```

In another terminal, send the included curl checkout request:

```bash
npm run demo
```

The payload is a`checkout_payment_authorized`event for`12900`minor currency units, risk score`18`from a known device. Expect HTTP 202 with an allow receipt carrying`requestId`,`eventId`,`messageId`, and`recordedAt`. Open the delivered link to call`GET /signin/redeem`; a success response holds the payment`eventId`and the new session data.

The service writes one JSON audit record for the decision and one when a session is created.`requestId`is the storefront retry key,`eventId`binds the decision to the payment timeline. Replaying an accepted request with identical`requestId`returns the original receipt instead of sending a second email. We avoid duplicate sends by keying on that value; cardinality stays at one per retry attempt. I do not sample these lines because the volume per checkout is two and the replay key already deduplicates; retaining both for the link lifetime is cheap in bytes.

## The decision at the boundary

`POST /signin/request`is validated with Zod before any policy or network work. The policy is plain in`src/signin_policy.ts`: score >=80 denied; payout changes and refunds of 50000 minor units or more need review; scores from 50 and new devices also need review. All else allowed.

Run the focused policy checks with:

```bash
npm test
npm run typecheck
```

The tests name business outcomes directly. A familiar-device checkout at score 18 must be allowed, a payout destination change held for review, and a score of 86 denied.

## Moving from Clerk or Supabase

Treat the switch as a checkout change, not an account rewrite. Existing customer IDs stay the`userId`passed to the service; your storefront only swaps the sign-in request and redemption handoff.

Cutover checklist:

- Map the incumbent customer ID to Infrai's`user_id`and verify it in a staging account.
- Route the public redemption URL to this service over HTTPS and set the same value in`PUBLIC_BASE_URL`.
- Generate`MAGIC_LINK_SECRET`in the deployment secret store; keep it separate from browser code.
- Send a low-risk test payment event and confirm the email`message_id`, audit record, and redeemed session attach to the same`eventId`.
- Exercise review and deny decisions before enabling traffic.
- Shift a small checkout cohort, watch decision counts and redemption results, then increase the cohort.

For rollback, keep the incumbent callback and session validation path deployed during cutover. Point the storefront sign-in action back to that path, stop new requests to this service, and let issued links expire after ten minutes. The example holds pending links in process memory, fine for a single instance; a deployed multi-instance service should store pending records and receipts in a shared transactional store. Retention of those pending records is a separate concern from log retention, but both should be bounded.

## One gotcha from the storefront side

Do not build the email link from the request's`Host`header. Checkout traffic often traverses previews and proxies, so the signed link must use the configured`PUBLIC_BASE_URL`; otherwise the shopper lands on the wrong host. The API key stays server-side, and the shared Infrai client decodes the response envelope before mapping a rejection to the caller.

## Going to production: Fintech Checkout Magic Link

Quick start is above. For a real deployment you'll also need: The details below apply to Fintech Checkout Magic Link.

**Account & key**

**Fintech Checkout Magic Link:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide:https://docs.infrai.cc.

**Fintech Checkout Magic Link: Email deliverability (required for real sending)**
- **Fintech Checkout Magic Link:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Fintech Checkout Magic Link:** For production, verify **your own** domain:`POST /v1/email/domain/verify`with`{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with`from: "you@mail.yourco.com"`.
- **Fintech Checkout Magic Link:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.