# Verified purchase access — staging only

## What has been implemented
- Authenticated Checkout Session endpoint: POST /api/checkout (requires a Supabase user access token).
- Stripe-signature-verified webhook: POST /api/stripe/webhook; grants a purchase record only if the Stripe session is paid and contains the configured price.
- Authenticated entitlement lookup: GET /api/me/programmes.
- Short-lived (60s) signed PDF download: POST /api/me/combat-strength/pdf; checks active entitlement first.
- Supabase SQL table with RLS; private storage bucket must be manually created.

## Configuration required on hosting (never GitHub)
STRIPE_SECRET_KEY (use sandbox/test for staging)
STRIPE_WEBHOOK_SECRET
STRIPE_COMBAT_PRICE_ID
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY (server only)
PUBLIC_SITE_ORIGIN (HTTPS staging origin)

Apply supabase/schema.sql to your Supabase project and create a PRIVATE bucket paid-programmes.
Upload the PDF at combat-strength/MStrength101_Combat_Strength_Package.pdf. Do not upload PDFs to this public repository.
Configure Stripe's webhook destination at https://STAGING_HOST/api/stripe/webhook for checkout.session.completed and checkout.session.async_payment_succeeded.
Use Stripe test-mode resources and never put Stripe secret keys or Supabase service role keys in browser scripts.

## Not ready to launch
- Missing customer login UI and dashboard connection (server API only).
- No refund or dispute revocation/reconciliation yet.
- Webhook idempotence relies on unique Checkout Session, but should also persist and audit event IDs.
- No end-to-end payment / storage security tests completed.
- Hosting backend compatibility, HTTPS origin and deploy strategy not verified.
- Price, taxation and published programme terms must be approved.
- Current public homepage Gumroad links remain unchanged.

Do not merge as a live checkout release. Test on staging, then enable the replacement deliberately.
