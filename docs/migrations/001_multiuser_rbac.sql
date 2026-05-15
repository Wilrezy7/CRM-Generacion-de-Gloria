-- CRM Generacion de Gloria - multiusuario RBAC y mentorias
-- Ejecutar en Supabase SQL Editor con una cuenta administradora del proyecto.

create extension if not exists pgcrypto;

do $$
begin
  create type public.crm_user_role as enum ('ADMIN', 'PASTOR', 'LIDER', 'MENTOR', 'SECRETARIA');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type public.crm_user_role add value if not exists 'SECRETARIA';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.member_role as enum ('Miembro', 'Mentor', 'Lider', 'Pastor');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.users (
  id text primary key,
  full_name text not null,
  email text not null unique,
  password_hash text not null,
  role public.crm_user_role not null default 'MENTOR',
  active boolean not null default true,
  must_change_password boolean not null default true,
  last_login timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.members (
  id text primary key,
  full_name text not null,
  document_id text not null unique,
  phone text,
  email text,
  birth_date date,
  baptized text not null default 'NO' check (baptized in ('SI', 'NO')),
  member_role public.member_role not null default 'Miembro',
  address text,
  join_date date not null default current_date,
  status text not null default 'activo' check (status in ('activo', 'inactivo')),
  notes text,
  user_id text references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.mentor_assignments (
  id text primary key,
  mentor_user_id text not null references public.users(id) on delete cascade,
  youth_id text not null references public.members(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (mentor_user_id, youth_id)
);

create table if not exists public.attendance_sessions (
  id text primary key,
  title text not null,
  service_type text not null default 'servicio',
  date date not null,
  notes text,
  created_by text references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.attendance_records (
  id text primary key,
  attendance_session_id text not null references public.attendance_sessions(id) on delete cascade,
  youth_id text not null references public.members(id) on delete cascade,
  present boolean not null default false,
  unique (attendance_session_id, youth_id)
);

create table if not exists public.visits (
  id text primary key,
  youth_id text not null references public.members(id) on delete cascade,
  mentor_user_id text not null references public.users(id) on delete cascade,
  date date not null,
  location text,
  observations text,
  result text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.calls (
  id text primary key,
  youth_id text not null references public.members(id) on delete cascade,
  mentor_user_id text not null references public.users(id) on delete cascade,
  date date not null,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  observations text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.meetings (
  id text primary key,
  youth_id text not null references public.members(id) on delete cascade,
  mentor_user_id text not null references public.users(id) on delete cascade,
  date date not null,
  type text not null default 'mentoria',
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pastoral_notes (
  id text primary key,
  youth_id text not null references public.members(id) on delete cascade,
  author_user_id text not null references public.users(id) on delete cascade,
  note text not null,
  private boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.alerts (
  id text primary key,
  youth_id text not null references public.members(id) on delete cascade,
  reason text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'atendida')),
  generated_at timestamptz not null default timezone('utc', now()),
  attended_at timestamptz,
  attended_by text references public.users(id) on delete set null
);

create table if not exists public.activity_logs (
  id text primary key,
  user_id text references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reports (
  id text primary key,
  generated_by text references public.users(id) on delete set null,
  type text not null,
  filters jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.report_downloads (
  id text primary key,
  report_id text references public.reports(id) on delete cascade,
  format text not null check (format in ('pdf', 'excel')),
  downloaded_by text references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_users_role_active on public.users(role, active);
create index if not exists idx_members_role_status on public.members(member_role, status);
create index if not exists idx_members_user_id on public.members(user_id);
create index if not exists idx_assignments_mentor on public.mentor_assignments(mentor_user_id);
create index if not exists idx_assignments_youth on public.mentor_assignments(youth_id);
create index if not exists idx_visits_mentor_date on public.visits(mentor_user_id, date desc);
create index if not exists idx_calls_mentor_date on public.calls(mentor_user_id, date desc);
create index if not exists idx_meetings_mentor_date on public.meetings(mentor_user_id, date desc);
create index if not exists idx_notes_youth_date on public.pastoral_notes(youth_id, created_at desc);
create index if not exists idx_activity_user_date on public.activity_logs(user_id, created_at desc);
create index if not exists idx_reports_type_date on public.reports(type, created_at desc);
create index if not exists idx_report_downloads_report on public.report_downloads(report_id, created_at desc);

alter table public.users enable row level security;
alter table public.members enable row level security;
alter table public.mentor_assignments enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.visits enable row level security;
alter table public.calls enable row level security;
alter table public.meetings enable row level security;
alter table public.pastoral_notes enable row level security;
alter table public.alerts enable row level security;
alter table public.activity_logs enable row level security;
alter table public.reports enable row level security;
alter table public.report_downloads enable row level security;

revoke all on public.users from anon, authenticated;
revoke all on public.members from anon, authenticated;
revoke all on public.mentor_assignments from anon, authenticated;
revoke all on public.attendance_sessions from anon, authenticated;
revoke all on public.attendance_records from anon, authenticated;
revoke all on public.visits from anon, authenticated;
revoke all on public.calls from anon, authenticated;
revoke all on public.meetings from anon, authenticated;
revoke all on public.pastoral_notes from anon, authenticated;
revoke all on public.alerts from anon, authenticated;
revoke all on public.activity_logs from anon, authenticated;
revoke all on public.reports from anon, authenticated;
revoke all on public.report_downloads from anon, authenticated;

comment on table public.users is 'Usuarios reales del CRM: login, RBAC, estado y seguridad.';
comment on table public.members is 'Miembros ministeriales. Fuente de rol ministerial y datos pastorales.';
comment on table public.mentor_assignments is 'Relacion mentor/lider/pastor -> miembros asignados.';
comment on table public.activity_logs is 'Auditoria funcional del CRM.';
comment on table public.reports is 'Informes institucionales generados y sus filtros.';
comment on table public.report_downloads is 'Trazabilidad de descargas PDF y Excel.';
