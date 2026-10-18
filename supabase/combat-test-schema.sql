-- Separate Stripe test-mode entitlement records. These do NOT unlock live sales.
-- Applied to Supabase as migration isolated_stripe_test_checkout.
create table if not exists public.combat_test_entitlements (
  checkout_session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_intent_id text not null unique,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now()
);
alter table public.combat_test_entitlements enable row level security;
revoke all on public.combat_test_entitlements from public, anon, authenticated;
grant select,insert,update on public.combat_test_entitlements to service_role;
create index if not exists combat_test_entitlements_member_idx on public.combat_test_entitlements(user_id);

create table if not exists public.combat_test_revocations (
  payment_intent_id text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.combat_test_revocations enable row level security;
revoke all on public.combat_test_revocations from public, anon, authenticated;
grant select,insert,update on public.combat_test_revocations to service_role;

create or replace function public.record_combat_test_purchase(p_user_id uuid,p_checkout_session text,p_payment_intent text)
returns boolean language plpgsql security definer set search_path=public as $$
declare inserted_count integer := 0;
begin
  if p_user_id is null or nullif(p_checkout_session,'') is null or nullif(p_payment_intent,'') is null then return false; end if;
  insert into public.combat_test_entitlements(checkout_session_id,user_id,payment_intent_id,status)
  select p_checkout_session,p_user_id,p_payment_intent,'active'
  where not exists (select 1 from public.combat_test_revocations where payment_intent_id=p_payment_intent)
  on conflict(checkout_session_id) do nothing;
  get diagnostics inserted_count = ROW_COUNT;
  return inserted_count > 0;
end $$;

create or replace function public.revoke_combat_test_purchase(p_payment_intent text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if nullif(p_payment_intent,'') is null then return; end if;
  insert into public.combat_test_revocations(payment_intent_id,reason)
  values(p_payment_intent,coalesce(nullif(p_reason,''),'payment_reversed'))
  on conflict(payment_intent_id) do update set reason=excluded.reason;
  update public.combat_test_entitlements set status='revoked' where payment_intent_id=p_payment_intent;
end $$;

revoke all on function public.record_combat_test_purchase(uuid,text,text) from public,anon,authenticated;
revoke all on function public.revoke_combat_test_purchase(text,text) from public,anon,authenticated;
grant execute on function public.record_combat_test_purchase(uuid,text,text) to service_role;
grant execute on function public.revoke_combat_test_purchase(text,text) to service_role;
