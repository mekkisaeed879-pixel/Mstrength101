-- Run in Supabase SQL editor, not in the public application.
create table if not exists public.programme_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  programme_id text not null check (programme_id = 'combat-strength'),
  stripe_checkout_session_id text not null unique,
  status text not null check (status in ('active','revoked')),
  created_at timestamptz not null default now()
);
create index if not exists programme_entitlements_user_idx on public.programme_entitlements(user_id);
alter table public.programme_entitlements enable row level security;
revoke all on public.programme_entitlements from anon,authenticated;
-- All access goes through the trusted server after Supabase Auth verifies the JWT.
-- Create a PRIVATE Supabase Storage bucket named 'paid-programmes';
-- do not create anonymous select policies on storage.objects.
