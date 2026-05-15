-- Esquema legado minimo para compatibilidad.
-- El SQL completo profesional esta en:
-- docs/migrations/001_multiuser_rbac.sql
-- Ejecuta primero este archivo solo si necesitas conservar el respaldo crm_state.

create table if not exists public.crm_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.crm_state enable row level security;
revoke all on public.crm_state from anon, authenticated;

comment on table public.crm_state is
'Estado legado del CRM. Usar solo como respaldo mientras se migra a tablas normalizadas.';
