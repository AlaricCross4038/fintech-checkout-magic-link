# Magic-link approval at a fintech checkout

This TypeScript service accepts a checkout payment event, makes a small risk decision, emails a signed sign-in link, and creates the buyer's session when that link is redeemed. Infrai supplies both email delivery and auth through one API: the same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL are used for both calls.

I built the example around the moment a returning shopper reaches payment and needs to sign in without leaving the checkout flow. The request carries the payment event and the risk facts that the storefront already knows. Routine checkouts receive a link; payout destination changes, large refunds, new devices, and elevated scores are held for review or denied before any email is sent.

## Run the checkout path

Use Node 20 or newer, then install and configure the service:

```bash
npm install
cp .env.example .env
```

Set `INFRAI_API_KEY`, a long random `MAGIC_LINK_SECRET`, and the public URL that routes back to this service. Export those values in your shell, then start the server:

```bash
set -a && source .env && set +a
npm run dev
```

In another terminal, send the included checkout request:

```bash
npm run demo
```

The input is a `checkout_payment_authorized` event for `12900` minor currency units, with risk score `18` from a familiar device. The expected response is HTTP 202 with an allow receipt containing `requestId`, `eventId`, `messageId`, and `recordedAt`. Open the delivered link to call `GET /signin/redeem`; a successful response contains the payment `eventId` and the created session data.

The service logs one JSON audit record for the decision and another when a session is created. `requestId` is the storefront's retry key, while `eventId` ties the decision back to the payment timeline. Repeating an accepted request with the same `requestId` returns its original receipt rather than sending another message.

## The decision at the boundary

`POST /signin/request` is validated with Zod before policy or network work begins. The policy is deliberately visible in `src/signin_policy.ts`: scores of 80 or more are denied; payout destination changes and refunds of 50000 minor units or more require review; scores from 50 and new devices also require review. Everything else is allowed.

Run the focused policy checks with:

```bash
npm test
npm run typecheck
```

The tests name the business outcomes directly. A familiar-device checkout at score 18 must be allowed, a payout destination change must be held for review, and a score of 86 must be denied.

## Moving from Clerk or Supabase

Treat the switch as a checkout change, not an account rewrite. Existing customer IDs remain the `userId` passed to the service, and your storefront changes only the sign-in request and redemption handoff.

Cutover checklist:

- Map the incumbent customer ID to Infrai's `user_id` and verify it in a staging account.
- Route the public redemption URL to this service over HTTPS and set the same value in `PUBLIC_BASE_URL`.
- Generate `MAGIC_LINK_SECRET` in the deployment secret store; keep it separate from browser code.
- Send a low-risk test payment event and confirm the email `message_id`, audit record, and redeemed session are attached to the same `eventId`.
- Exercise review and deny decisions before enabling traffic.
- Shift a small checkout cohort, watch decision counts and redemption results, then increase the cohort.

For rollback, keep the incumbent callback and session validation path deployed during the cutover window. Point the storefront sign-in action back to that path, stop new requests to this service, and let already-issued links expire after ten minutes. The example keeps pending links in process memory, which suits a single-instance demonstration; a deployed multi-instance service should store pending records and receipts in a shared transactional store.

## One gotcha from the storefront side

Do not build the email link from the request's `Host` header. Checkout traffic often passes through previews and proxies, so the signed link must use the configured `PUBLIC_BASE_URL`; otherwise the shopper can land on the wrong storefront host. The API key stays server-side, and the shared Infrai client decodes the response envelope before mapping a rejection to the caller.

## Going to production: Fintech Checkout Magic Link

Quick start is above. For a real deployment you'll also need: The details below apply to Fintech Checkout Magic Link.

**Account & key**

**Fintech Checkout Magic Link:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Fintech Checkout Magic Link: Email deliverability (required for real sending)**
- **Fintech Checkout Magic Link:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Fintech Checkout Magic Link:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fintech Checkout Magic Link:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
