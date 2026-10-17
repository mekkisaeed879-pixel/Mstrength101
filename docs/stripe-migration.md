# MStrength101 — Stripe migration plan (staging only)

## Current state
- Connected Stripe account: Mstrength101 (live account). The Explosive Combat Strength Package was **not** among the products returned on 17 October 2026.
- Existing live website still links to Gumroad for checkout and existing-product access.
- `dashboard.html` is a **prototype**: no member login, entitlements or real PDFs.
- `stripe-checkout.html` is an intentionally disabled checkout preview, **not** a payment system.
- User reported zero previous Gumroad purchasers. Confirm in the Gumroad dashboard before shutting it down.

## Architecture to implement
1. Create a **test-mode** Stripe one-time product/price for Explosive Combat Strength Package (price and tax treatment to be confirmed).
2. Configure hosted Stripe Checkout Session creation on a deployed Node server (not client HTML). Take the price ID from server environment, never trust client-supplied prices.
3. Set up Supabase Auth for member sign-in and a restricted database table for entitlements mapped to Supabase user ID and Stripe Checkout Session ID; validate permissions.
4. Stripe webhook: verify signatures against the **raw request body**, persist event IDs idempotently, and grant a programme entitlement only after confirmed successful payment. Handle delayed payment events, refunds and chargebacks.
5. Store PDFs in a **private** bucket. Use authenticated short-lived signed URLs after verifying the current member's entitlement. Never commit paid PDFs or secret keys to this public repo.
6. Load actual workout content into authenticated views (not public `dashboard.html`), persist progress per user with authorization.
7. Verify staging checkout, webhook retries, login/logout, purchase ownership, PDF access, declined payments, refund/revocation and mobile flows.
8. Configure live-mode price and keys, run a real low-value end-to-end test, monitor fulfilment, **then** change the homepage link away from Gumroad.
9. Remove Gumroad links only after the new path is confirmed working.

## Deployment prerequisites
- Verify hosting supports the Express backend, persistent environment variables, and a public HTTPS webhook endpoint. A static-only deployment cannot securely create Checkout Sessions.
- Stripe secret key and webhook signing secret in hosting secrets only (never browser or Git).
- Supabase URL/anon public key for browser; service role key on trusted server only.
- Confirm programme PDF and product price with owner.
- Include privacy policy, refund terms, and required VAT/tax considerations before going live.

## Safety
No live Stripe objects were created by this branch. No live Gumroad checkout links were changed.
