create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key default ('usr_' || replace(gen_random_uuid()::text, '-', '')),
  full_name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('ADMIN','PASTOR','SECRETARIA','LIDER','MENTOR')),
  active boolean not null default true,
  email_verified boolean not null default false,
  must_change_password boolean not null default true,
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

create table if not exists public.password_resets (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.access_requests (
  id text primary key,
  full_name text not null,
  email text not null,
  requested_role text not null check (requested_role in ('ADMIN','PASTOR','SECRETARIA','LIDER','MENTOR')),
  status text not null default 'PENDING_EMAIL',
  token_hash text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
alter table public.password_resets enable row level security;
alter table public.access_requests enable row level security;
alter table public.audit_logs enable row level security;

create index if not exists users_email_idx on public.users (lower(email));
create index if not exists user_sessions_user_id_idx on public.user_sessions (user_id);
create index if not exists user_sessions_token_hash_idx on public.user_sessions (token_hash);
create index if not exists password_resets_token_hash_idx on public.password_resets (token_hash);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

