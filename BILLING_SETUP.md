# NoteFlow AI billing

## Architecture and modified files

The existing React/Vite application, Firebase authentication, Express API, and Firestore database are reused. The Python AI service is unchanged. No payment provider existed before this change.

- `backend/src/services/billingProvider.js`: official Stripe SDK adapter, server price validation, embedded checkout, portal, signature verification.
- `backend/src/services/billingService.js`: user/customer mapping, subscription synchronization, checkout recovery, database leases, webhook deduplication, and account-bound checkout-session status.
- `backend/src/database/billingStore.js`: Firestore-backed billing accounts and event receipts, with legacy SQLite support.
- `backend/src/app.js`: authenticated billing routes and raw-body webhook before JSON parsing.
- `backend/tests/billing.test.js`: authenticated API, subscription lifecycle, isolation, webhook and idempotency checks with a mock provider and real Stripe signature verification.
- `backend/.env.example`: server billing configuration.
- `frontend/src/billing/Billing.jsx`, `Billing.css`: checkout, results, settings, pricing buttons and responsive styles; success returns include Stripe's `{CHECKOUT_SESSION_ID}` placeholder and verify session ownership before displaying provider status.
- `frontend/src/billing/intent.js`, `intent.test.js`: selected-plan persistence across authentication.
- `frontend/src/App.jsx`: registration alias, checkout/result/legal routes and authentication continuation.
- `frontend/src/api/client.js`: authenticated billing requests and coalesced per-user synchronization requests.
- `frontend/src/components/Main/Main.jsx`, `frontend/src/billing/Pricing.jsx`, `frontend/src/billing/plans.js`: landing and `/pricing` cards for Free, Plus, and public Pro; Pro retains the internal `team` ID.
- `frontend/src/components/Dashboard/Dashboard.jsx`: Pricing navigation, password-provider linking, and Billing & Subscription settings.
- `frontend/.env.billing.example`: public billing settings.
- `frontend/scripts/billing-check.mjs`: browser auth handoff, checkout, cancellation, success verification and responsive checks using test-only intercepted Firebase/API modules.
- `frontend/scripts/responsive-check.mjs`: existing theme assertions updated to match the repository's current colors and additional billing stylesheet.
- Both package manifests/lockfiles: official Stripe SDKs; Playwright Core is a frontend development dependency.
- `frontend/artifacts/billing/*` and refreshed `frontend/artifacts/responsive/*`: browser verification evidence.

## API

- `POST /api/billing/checkout` — Firebase bearer token, JSON `{ "plan": "free" | "plus" | "team" }`. Returns an embedded checkout client secret, portal URL for changes, current-plan indicator, or internal destination. Client prices/statuses are ignored.
- `GET /api/billing/subscription` — Firebase bearer token. Retrieves current Stripe state when a customer exists; returns effective plan, billing plan, status, monthly price, period dates, cancellation state and synchronization timestamp. Provider failures return errors rather than stale paid access.
- `POST /api/billing/portal` — Firebase bearer token. Returns the authenticated customer's portal URL.
- `POST /api/billing/webhook` — raw JSON with Stripe signature; no Firebase token. Invalid signatures return 400. Duplicate event IDs are acknowledged without reprocessing. A failed synchronization is not marked processed, allowing Stripe retries.

Subscriptions are stored with Firebase UID, customer/subscription IDs, status, billing periods, cancellation flag and synchronization time. Active/trialing subscriptions require a non-expired period for paid entitlement. Past-due, unpaid, paused, canceled and expired subscriptions receive the Free effective plan. Historical billing plan/status remain visible. Daily AI quotas and note-count entitlements are enforced server-side from this provider-synchronized state.

Free receives 20 AI requests/day and up to 30 notes; Plus receives 200/day and up to 500 notes; Pro (legacy Stripe/internal `team`) receives 1,000/day and no plan-level note count. The current search implementation is keyword-based; semantic search and priority scheduling are not implemented or advertised as active features.

Upgrades/downgrades use a Stripe portal confirmation flow with the exact selected price. Stripe displays prorations and handles payment authentication. Selecting Free while subscribed opens the portal to confirm cancellation; clicking Free never silently cancels a subscription. Portal configuration controls timing/proration policy. Checkout success URLs never activate a plan.

## Configuration

Backend environment:

- `STRIPE_SECRET_KEY`: secret key for the selected Stripe account and test/live mode.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this exact webhook endpoint/mode.
- `STRIPE_PRICE_PLUS`: active, licensed USD monthly recurring Price for **600 cents**, quantity one.
- `STRIPE_PRICE_TEAM`: active, licensed USD monthly recurring Price for **1200 cents**, quantity one.
- `BILLING_APP_URL`: canonical frontend origin (HTTPS in production), without a trailing path. It controls return URLs; client input cannot override it.
- Retain existing `FIREBASE_PROJECT_ID`, Firebase Admin credentials, `STORAGE_DRIVER=firestore`, optional `FIRESTORE_DATABASE_ID`, and `CORS_ORIGINS` configuration. SQLite remains available only with `STORAGE_DRIVER=sqlite`.

Frontend `.env.local` (rebuild after changes):

- `VITE_STRIPE_PUBLISHABLE_KEY`: public key matching backend account/mode.
- `VITE_TERMS_URL`, `VITE_PRIVACY_URL`: URLs of the operator's published legal policies. Local informational pages are placeholders pending those policies.
- Retain existing Firebase configuration and API base URL/proxy settings.

Never put a secret key or webhook secret into a `VITE_` variable. Missing billing configuration produces an explicit unavailable message. Test sessions visibly say **Test mode — no real payments**. There is no automatic test fallback.

## Stripe setup

1. Confirm that your business can open and activate a Stripe merchant account in its jurisdiction. This code does not create a merchant account or establish eligibility.
2. In a Stripe sandbox, create Plus and Team products with the recurring USD prices above. Configure the environment with actual keys and Price IDs from that sandbox.
3. Enable the customer portal: payment-method changes, invoice history, subscription cancellation, and price changes between these two products. Set cancellation timing and proration behavior explicitly. Restrict products and quantities to these plans (one unit). Configure NoteFlow branding, support/contact details and legal URLs.
4. Configure card payments. Stripe's embedded form renders Visa/Mastercard branding and eligible wallet buttons. Enable Apple Pay/Google Pay as supported and register production/staging payment domains. HTTPS, browser/device, customer wallet setup, account eligibility and Stripe configuration affect visibility. Do not add static wallet buttons claiming availability.
5. Register a **snapshot** webhook at `https://YOUR_API/api/billing/webhook`, using the installed Stripe SDK's API version. Subscribe to `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`; `invoice.paid`, `.payment_failed`, `.payment_action_required`; `checkout.session.completed`, `.expired`, `.async_payment_succeeded`, `.async_payment_failed`.
6. For localhost use `stripe listen --forward-to localhost:3000/api/billing/webhook` and its emitted signing secret. Match the actual backend port and frontend `BILLING_APP_URL`. Firebase authorized domains must include the development host.
7. Exercise initial payment, required card authentication, decline/retry, both plan changes, cancellation, renewal failure, duplicate/out-of-order webhooks, sign-in/register with both providers, browser refresh and wallet eligibility with Stripe test methods. No real customer card data is needed for these tests.
8. Deploy behind HTTPS with SPA fallback routing, Firestore backups and appropriate API CORS. If using the optional SQLite driver, provide a persistent volume and backups. If adding CSP, allow the Stripe scripts/frames/network endpoints required by its documentation. Publish full legal policies before enabling live billing.
9. Repeat configuration using separate **live** keys, products/prices, portal configuration and webhook signing secret. Verify a controlled authorized live subscription and cancellation before declaring payments operational.

Official references: [embedded subscriptions](https://docs.stripe.com/billing/subscriptions/build-subscriptions?ui=embedded-form), [portal confirmation flows](https://docs.stripe.com/customer-management/portal-deep-links), [webhooks](https://docs.stripe.com/webhooks), [payment-method domains](https://docs.stripe.com/payments/payment-methods/pmd-registration).

## Operations and verification limits

Checkout attempts persist provider idempotency keys before network calls and reuse open sessions. Changing plans expires the previous open session. SQLite leases prevent concurrent checkout/synchronization across processes sharing the same database; clients may receive a retryable 409 while another operation is running. An uncertain checkout older than 23 hours fails closed for support review before Stripe's idempotency retention window is exceeded. Reconcile that customer's Stripe sessions before clearing a stuck attempt. A customer with multiple nonterminal subscriptions also fails closed for support review.

Webhooks fetch current provider state instead of applying potentially stale payloads. Failed/missing-account webhook synchronization returns a retryable error. Monitor webhook delivery failures, `BILLING_BUSY`, and `CHECKOUT_REVIEW_REQUIRED`; investigate prolonged locks or failures before manual replay. Use one durable SQLite deployment; horizontally distributed replicas with independent databases are unsupported.

Run from `backend`: `npm.cmd test`.
Run from `frontend`: `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`.
For browser checks, run Vite on port 5174, set `CHROMIUM_PATH` to an installed Chromium/Edge executable, then run `node scripts/billing-check.mjs` and `node scripts/responsive-check.mjs`.

Automated provider tests are mocks, and browser authentication/API tests use isolated module interception. They do not prove merchant configuration, real Firebase identity exchange, Stripe-hosted form layout, wallet availability, or live charges. Those require the configured staging/live verification above. npm reports existing dependency advisories and Firebase packages requiring Node >=24.12.0; this workspace currently runs Node 22.15.0. Upgrade the runtime and review dependency advisories before production deployment.

Verified in this workspace: 32 backend tests; 10 frontend tests; frontend lint and production build; 33 billing browser checks at 320, 375, 768, 1024, 1440 and 2560 pixels; existing responsive checks at 12 widths from 320 to 2560 pixels. Screenshots were inspected at mobile and desktop sizes. The production build reports a roughly 501 kB chunk warning. npm installation reports 6 moderate backend advisories and 10 frontend advisories (6 moderate, 4 high); no forced dependency upgrades were performed.
