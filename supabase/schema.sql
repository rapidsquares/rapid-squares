-- =====================================================================
-- Rapid Squares — Supabase database setup
--
-- How to run: Supabase dashboard › SQL Editor › New query › paste this
-- whole file › Run. Safe to run again: it only creates what's missing
-- and refreshes the price list.
--
-- Design (matches the Company Data Schema doc):
--   • Supabase handles sign-in (auth.users) and stores the data.
--   • The Node.js backend does every read and write with the service key.
--   • Row-level security is ON for every table with NO policies, so the
--     public (anon) key and signed-in browsers can't read or change
--     anything directly. The service key bypasses RLS.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- types ----------
do $$ begin
  create type public.user_role as enum ('owner', 'admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum
    ('awaiting_payment', 'pending', 'in_progress', 'needs_info', 'delivered', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception when duplicate_object then null; end $$;

-- ---------- shared trigger: keep updated_at current ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- companies (the tenant) ----------
create table if not exists public.companies (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null check (length(trim(name)) > 0),
  license_number              text,
  contact_name                text,
  phone                       text,
  email                       text,
  website                     text,
  address                     text,
  -- branding
  logo_url                    text,
  brand_color                 text,
  roofquery_brand_profile_id  text,
  -- Stripe
  stripe_customer_id          text unique,
  stripe_config               jsonb not null default '{}'::jsonb,
  subscription_status         text not null default 'none'
                                check (subscription_status in ('none', 'active', 'past_due', 'canceled')),
  subscription_plan           text check (subscription_plan in ('monthly', 'yearly')),
  subscription_renews_at      timestamptz,
  -- free reports for new accounts (amount set by the backend's FREE_REPORTS_ON_SIGNUP)
  free_reports_remaining      integer not null default 0 check (free_reports_remaining >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();

-- ---------- users (one profile per login) ----------
create table if not exists public.users (
  id                   uuid primary key references auth.users (id) on delete cascade,
  company_id           uuid not null references public.companies (id) on delete cascade,
  full_name            text not null default '',
  email                text,
  phone                text,
  office_phone         text,
  preferred_contact    text,
  timezone             text,
  job_title            text,
  avatar_url           text,
  role                 public.user_role not null default 'user',
  preset               text,                         -- Team page preset: admin · manager · estimator · viewer · custom
  permissions          text[] not null default '{}', -- orders.create · orders.view_all · orders.download · branding.edit · billing.manage · users.manage
  monthly_order_limit  integer check (monthly_order_limit is null or monthly_order_limit >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists users_company_idx on public.users (company_id);
drop trigger if exists users_touch on public.users;
create trigger users_touch before update on public.users
  for each row execute function public.touch_updated_at();

-- ---------- invites ----------
create table if not exists public.invites (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  email                text not null,
  full_name            text,
  job_title            text,
  role                 public.user_role not null default 'user',
  preset               text,
  permissions          text[] not null default '{}',
  monthly_order_limit  integer,
  invited_by           uuid references public.users (id) on delete set null,
  token_hash           text not null unique,      -- SHA-256 of the link token; the raw token is never stored
  status               public.invite_status not null default 'pending',
  expires_at           timestamptz not null,
  accepted_by          uuid references public.users (id) on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists invites_company_idx on public.invites (company_id, status);
create unique index if not exists invites_one_pending_per_email
  on public.invites (company_id, lower(email)) where status = 'pending';

-- ---------- products (price list) ----------
create table if not exists public.products (
  id                      text primary key,
  label                   text not null,
  price_cents             integer not null check (price_cents >= 0),
  subscriber_price_cents  integer not null check (subscriber_price_cents >= 0),
  esx_addon_allowed       boolean not null default false,
  available               boolean not null default true,
  delivery_minutes        integer,
  sort                    integer not null default 0
);
insert into public.products (id, label, price_cents, subscriber_price_cents, esx_addon_allowed, available, delivery_minutes, sort) values
  ('certified_residential', 'Certified Residential Rapid Squares',  700,  500, false, false,  30, 1),
  ('premium_residential',   'Premium Residential Report',          1200,  800, true,  true,  120, 2),
  ('commercial',            'Commercial Report',                   3000, 2500, true,  true,  null, 3),
  ('esx_addon',             'ESX file (Xactimate)',                 500,  500, false, true,  null, 9)
on conflict (id) do update set
  label = excluded.label, price_cents = excluded.price_cents, subscriber_price_cents = excluded.subscriber_price_cents,
  esx_addon_allowed = excluded.esx_addon_allowed, available = excluded.available,
  delivery_minutes = excluded.delivery_minutes, sort = excluded.sort;

-- ---------- report orders ----------
create sequence if not exists public.report_number_seq start 1001;

create table if not exists public.report_orders (
  id                          uuid primary key default gen_random_uuid(),
  report_number               bigint not null unique default nextval('public.report_number_seq'),
  company_id                  uuid not null references public.companies (id) on delete cascade,
  ordered_by                  uuid references public.users (id) on delete set null,
  report_type                 text not null references public.products (id),
  address                     text not null,
  lat                         double precision,
  lon                         double precision,
  status                      public.order_status not null default 'awaiting_payment',
  price_cents                 integer not null default 0 check (price_cents >= 0),
  esx_purchased               boolean not null default false,
  used_free_report            boolean not null default false,
  stripe_payment_id           text,
  stripe_checkout_session_id  text,
  roofquery_order_id          text unique,
  total_squares               numeric,
  predominant_pitch           text,
  measurements                jsonb,
  report_url                  text,
  status_detail               text,
  completed_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists report_orders_company_idx on public.report_orders (company_id, created_at desc);
create index if not exists report_orders_user_idx on public.report_orders (ordered_by, created_at desc);
drop trigger if exists report_orders_touch on public.report_orders;
create trigger report_orders_touch before update on public.report_orders
  for each row execute function public.touch_updated_at();

-- ---------- roof photos ----------
create table if not exists public.report_photos (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.report_orders (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  file_path    text not null,
  caption      text,
  uploaded_by  uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists report_photos_order_idx on public.report_photos (order_id);

-- ---------- revisions ----------
create table if not exists public.revisions (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.report_orders (id) on delete cascade,
  company_id             uuid not null references public.companies (id) on delete cascade,
  requested_by           uuid references public.users (id) on delete set null,
  topic                  text,
  message                text,
  status                 text not null default 'submitted' check (status in ('submitted', 'in_progress', 'completed', 'rejected')),
  roofquery_revision_id  text,
  created_at             timestamptz not null default now(),
  completed_at           timestamptz
);
create index if not exists revisions_order_idx on public.revisions (order_id);

-- ---------- emails sent ----------
create table if not exists public.email_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies (id) on delete cascade,
  order_id     uuid references public.report_orders (id) on delete set null,
  type         text not null,       -- order_confirmation · file_ready · revision_submitted · revision_ready · invite
  to_email     text not null,
  provider_id  text,
  status       text not null default 'queued',
  created_at   timestamptz not null default now()
);

-- ---------- webhook events (so each Stripe/RoofQuery event is handled once) ----------
create table if not exists public.webhook_events (
  id           text primary key,     -- provider's event id
  source       text not null,        -- stripe · roofquery
  received_at  timestamptz not null default now()
);

-- ---------- guest orders (no account) ----------
-- A guest order has no company; it carries the guest's email instead.
alter table public.report_orders alter column company_id drop not null;
alter table public.report_orders add column if not exists guest_email text;
alter table public.report_orders add column if not exists guest_name  text;
alter table public.report_orders add column if not exists guest_phone text;
alter table public.report_orders add column if not exists receipt_url text;
-- RoofQuery: address parts for ordering, retry bookkeeping, refunds and the "report ready" email.
alter table public.report_orders add column if not exists address_parts  jsonb;
alter table public.report_orders add column if not exists rq_status      text;
alter table public.report_orders add column if not exists rq_error       text;
alter table public.report_orders add column if not exists rq_attempts    integer not null default 0;
alter table public.report_orders add column if not exists rq_next_try_at timestamptz;
alter table public.report_orders add column if not exists rq_checked_at  timestamptz;
alter table public.report_orders add column if not exists ready_notified boolean not null default false;
alter table public.report_orders add column if not exists refunded_at    timestamptz;
alter table public.report_orders add column if not exists refund_id      text;
alter table public.companies     add column if not exists roofquery_brand_hash text;
alter table public.companies     add column if not exists brand_text_color text;  -- header text on PDFs; empty = white
-- The ESX file bought after the report was delivered.
alter table public.report_orders add column if not exists esx_price_cents         integer;
alter table public.report_orders add column if not exists esx_purchased_at        timestamptz;
alter table public.report_orders add column if not exists esx_payment_id          text;
alter table public.report_orders add column if not exists esx_receipt_url         text;
alter table public.report_orders add column if not exists esx_checkout_session_id text;
create index if not exists report_orders_rq_retry_idx on public.report_orders (rq_next_try_at) where roofquery_order_id is null and rq_attempts > 0;
do $$ begin
  alter table public.report_orders add constraint report_orders_owner_check check (company_id is not null or guest_email is not null);
exception when duplicate_object then null; end $$;
create index if not exists report_orders_guest_email_idx on public.report_orders (lower(guest_email)) where guest_email is not null;

-- ---------- lock everything down: only the backend's service key gets in ----------
-- Row level security is ON for every table with no policies, so the public keys can't read anything.
alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.invites enable row level security;
alter table public.products enable row level security;
alter table public.report_orders enable row level security;
alter table public.report_photos enable row level security;
alter table public.revisions enable row level security;
alter table public.email_log enable row level security;
alter table public.webhook_events enable row level security;

-- Only the backend (service_role) may use the tables.
revoke all on public.companies from anon, authenticated;
revoke all on public.users from anon, authenticated;
revoke all on public.invites from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.report_orders from anon, authenticated;
revoke all on public.report_photos from anon, authenticated;
revoke all on public.revisions from anon, authenticated;
revoke all on public.email_log from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
grant usage on schema public to service_role;
grant all on public.companies to service_role;
grant all on public.users to service_role;
grant all on public.invites to service_role;
grant all on public.products to service_role;
grant all on public.report_orders to service_role;
grant all on public.report_photos to service_role;
grant all on public.revisions to service_role;
grant all on public.email_log to service_role;
grant all on public.webhook_events to service_role;
grant usage, select on sequence public.report_number_seq to service_role;
revoke all on sequence public.report_number_seq from anon, authenticated;

-- ---------- file storage ----------
-- Logos and profile photos are public (they appear on reports). Roof photos stay private.
insert into storage.buckets (id, name, public) values
  ('logos', 'logos', true),
  ('avatars', 'avatars', true),
  ('roof-photos', 'roof-photos', false)
on conflict (id) do nothing;
