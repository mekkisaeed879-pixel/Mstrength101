# MStrength101 restricted Stripe TEST checkout

This is a test-only checkout isolated from live keys, live price, and live entitlements. Never enable the public CHECKOUT_ENABLED flag merely to try the test purchase.

## Project URLs

- Test page: https://mstrength101.com/checkout-test.html
- Test API: https://gmthvtgopymddykouyhy.supabase.co/functions/v1/combat-test
- Test webhook: https://gmthvtgopymddykouyhy.supabase.co/functions/v1/combat-test?action=webhook
- Test Price ID: price_1URfp812wPi7k0d7KXFfPiRH
- Production endpoint (do not change): /functions/v1/stripe-combat-webhook

## Configure only these new Supabase Edge Secrets

- STRIPE_TEST_SECRET_KEY = Stripe test-mode API key for the account containing the supplied test Price ID; must begin with sk_test_
- STRIPE_TEST_WEBHOOK_SECRET = whsec_... signing secret for the TEST event destination below
- TEST_ALLOWED_EMAIL = email address of the single approved tester who will sign in to the athlete portal (not a Stripe secret)

**Do not overwrite** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_COMBAT_PRICE_ID, CHECKOUT_ENABLED. Do not share any secret values in chat or in GitHub.

## Set up the TEST Stripe webhook

From Stripe dashboard **test mode**, create an event destination using the test webhook URL above. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded, charge.dispute.created. Copy the webhook signing secret to STRIPE_TEST_WEBHOOK_SECRET in Supabase. This must be a test-mode webhook for the same account and key as the test price.

## Manual test

1. Confirm health GET /functions/v1/combat-test?action=health returns configured:true.
2. Sign in at https://mstrength101.com/member.html using TEST_ALLOWED_EMAIL.
3. Go to https://mstrength101.com/checkout-test.html and start a €19.99 **TEST** checkout; use a Stripe test card (not a real card).
4. Return to the test page, refresh status until testPurchase is true.
5. Click Verify private PDF download to verify a 60-second signed URL.
6. Optionally refund the test payment and verify the test purchase entitlement revokes.
7. Live Stripe product, live webhook and live checkout remain off until independent live configuration reviews.

The test entitlement is stored only in combat_test_entitlements, not the production programme_entitlements table, and the test endpoint is allowlisted to TEST_ALLOWED_EMAIL. The endpoint uses only sk_test_ keys and checks Stripe session.livemode is false.

No claim of a completed test purchase should be made until the test page visibly confirms access and the PDF download succeeds.
