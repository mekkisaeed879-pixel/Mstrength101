-- MStrength101 privileged purchase records. This is an idempotent snapshot.
create table if not exists public.programme_entitlements(
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
programme_id text not null check(programme_id='combat-strength'),
stripe_checkout_session_id text not null unique,
stripe_payment_intent_id text,
status text not null default 'active' check(status in ('active','revoked')),
created_at timestamptz not null default now());
alter table public.programme_entitlements add column if not exists stripe_payment_intent_id text;
alter table public.programme_entitlements enable row level security;
revoke all on public.programme_entitlements from anon,authenticated;
create index if not exists programme_entitlements_user_idx on public.programme_entitlements(user_id);
create index if not exists programme_entitlements_payment_intent_idx on public.programme_entitlements(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create table if not exists public.payment_revocations(payment_intent_id text primary key,reason text not null,created_at timestamptz not null default now());
alter table public.payment_revocations enable row level security;
revoke all on public.payment_revocations from anon,authenticated;

create or replace function public.record_combat_purchase(p_user_id uuid,p_checkout_session text,p_payment_intent text)
returns boolean language plpgsql security definer set search_path=public as $$
declare rows_written integer := 0;
begin
 if p_user_id is null or p_checkout_session is null or p_payment_intent is null then return false; end if;
 insert into public.programme_entitlements(user_id,programme_id,stripe_checkout_session_id,stripe_payment_intent_id,status)
 select p_user_id,'combat-strength',p_checkout_session,p_payment_intent,'active'
 where not exists(select 1 from public.payment_revocations where payment_intent_id=p_payment_intent)
 on conflict(stripe_checkout_session_id) do nothing;
 get diagnostics rows_written = ROW_COUNT;
 return rows_written > 0;
end $$;

create or replace function public.revoke_combat_purchase(p_payment_intent text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_payment_intent is null or p_payment_intent='' then return; end if;
 insert into public.payment_revocations(payment_intent_id,reason)
 values(p_payment_intent,coalesce(p_reason,'payment_reversal'))
 on conflict(payment_intent_id) do update set reason=excluded.reason;
 update public.programme_entitlements set status='revoked' where stripe_payment_intent_id=p_payment_intent;
end $$;

-- Explicit role revokes are essential: Supabase defaults grant anon/authenticated EXECUTE.
revoke all on function public.record_combat_purchase(uuid,text,text) from PUBLIC,anon,authenticated;
revoke all on function public.revoke_combat_purchase(text,text) from PUBLIC,anon,authenticated;
grant execute on function public.record_combat_purchase(uuid,text,text) to service_role;
grant execute on function public.revoke_combat_purchase(text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('paid-programmes','paid-programmes',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,allowed_mime_types=excluded.allowed_mime_types;
-- Private bucket: do not publish the programme PDF or add public storage read policies.
