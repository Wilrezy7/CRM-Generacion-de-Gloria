-- Migracion historica de referencia para el modelo institucional.
-- La aplicacion actual persiste el estado agregado en public.crm_state
-- usando docs/supabase-schema.sql. Este archivo documenta la forma logica
-- esperada si se normaliza el modelo en tablas relacionales.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key default ('usr_' || replace(gen_random_uuid()::text, '-', '')),
  full_name text not null,
  email text not null unique,
  password_hash text,
  role text not null check (role in ('ADMIN','PASTOR','SECRETARIA','LIDER','MENTOR')),
  active boolean not null default true,
  access_blocked boolean not null default false,
  linked_youth_id text,
  managed_from_youth boolean not null default false,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_id text,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.user_sessions enable row level security;
alter table public.audit_logs enable row level security;

create index if not exists users_email_idx on public.users (lower(email));
create index if not exists users_linked_youth_id_idx on public.users (linked_youth_id);
create index if not exists user_sessions_user_id_idx on public.user_sessions (user_id);
create index if not exists user_sessions_token_hash_idx on public.user_sessions (token_hash);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
