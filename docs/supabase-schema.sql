create table if not exists public.crm_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.crm_state enable row level security;

revoke all on public.crm_state from anon, authenticated;

comment on table public.crm_state is
'Estado agregado del CRM Generacion de Gloria. El backend sincroniza este registro usando una clave secreta de Supabase.';
