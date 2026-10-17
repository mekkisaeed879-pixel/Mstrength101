# MStrength101 digital programme access — staged deployment

## What is deployed
Supabase project `gmthvtgopymddykouyhy` in Ireland (eu-west-1).
- `member-access` Edge Function: Supabase user authentication, purchase checks, 60s signed PDF URLs, checkout creation.
- `stripe-combat-webhook` Edge Function: Stripe-signature verification, price and payment validation, entitlement grants, refund/dispute revocation.
- RLS-protected `programme_entitlements`, `payment_revocations`, atomic grant/revoke database functions, private `paid-programmes` Storage bucket.
- `member.html` client uses the Supabase publishable key (public by design), NOT a service role key.

## Sale details
Live Stripe product `prod_VSVi0mc05tlwVf` (inactive).
Live one-time €19.99 Stripe price `price_1URahDGY2fcKbCZO3eJNEhTk` (inactive).

## Secrets to enter in Supabase dashboard — not GitHub or chat
`STRIPE_SECRET_KEY` — use a Stripe TEST key for end-to-end staging.
`STRIPE_COMBAT_PRICE_ID` — corresponding Stripe TEST €19.99 price ID for staging, NOT the inactive live ID.
`STRIPE_WEBHOOK_SECRET` — signing secret for webhook endpoint in the same Stripe mode.

Do not set `CHECKOUT_ENABLED=true` until Stripe test-mode checkout, auth redirect configuration, paid member delivery and refund revocation tests pass. Checkout is disabled by default.

Supabase Edge Functions automatically provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; neither belongs in browser code.

Webhook endpoint URL:
`https://gmthvtgopymddykouyhy.supabase.co/functions/v1/stripe-combat-webhook`
Required Stripe event types:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`.

Configure Supabase Authentication > URL Configuration: site URL `https://mstrength101.com`; add exact redirect URL `https://mstrength101.com/member.html` and, if used, `https://www.mstrength101.com/member.html`.

The paid asset must be uploaded to the PRIVATE Supabase bucket `paid-programmes` under the path:
`combat-strength/MStrength101_Combat_Strength_Package.pdf`.
Do NOT commit the PDF to this public GitHub repository. Do NOT add any public storage read policy.

Checkout remains inactive, and the public Gumroad link remains unchanged.
Test the real browser login and the complete Stripe TEST checkout-to-download lifecycle before activating the live product, price or homepage checkout link.

### Constraints
- The connected Supabase management plugin can deploy functions and SQL, but it does not expose secret management or private file upload actions.
- The connected Stripe plugin can manage products/prices, but it does not expose a Stripe secret API key.
- The signed webhook cannot pass a full test until the signing secret has been saved in Supabase and a Stripe test webhook destination has been configured.
