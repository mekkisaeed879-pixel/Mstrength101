# MStrength101 — Combat Strength Package Stripe setup

Stripe live product: `prod_VSVi0mc05tlwVf`  
Stripe live one-time EUR 19.99 price: `price_1URahDGY2fcKbCZO3eJNEhTk`

Both product and price were deliberately created **inactive** for prelaunch. Do not turn on payments based solely on this file.

## Deployment configuration
- `STRIPE_COMBAT_PRICE_ID` must be populated from the correct Stripe environment. Live value is shown above; use a separately created TEST price for staging.
- Keep `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in host-managed secret variables, never the repository.
- Site server already references `STRIPE_COMBAT_PRICE_ID`; no hardcoded price identifier should be used in server checkout logic.
- A secure, working member sign-in interface is in PR #5 and requires testing and Supabase configuration.
- Entitlements and private PDF storage must be provisioned and verified before taking orders.
- Handle refunds and disputes, test failed and delayed payment flows, and verify webhook signature and retry behaviour.
- Activate live product and price only after end-to-end testing and a deliberate launch approval.
- Do not switch the public homepage from Gumroad until fulfilment works.

Product: MStrength101: Combat Strength Package
Sales model: one-time payment, no subscription.
