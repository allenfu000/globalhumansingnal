create table if not exists public.gs_control_messages (
  session_id text not null,
  role text not null,
  content text not null,
  source text not null default 'gs-control',
  created_at timestamptz not null default now()
);

create index if not exists gs_control_messages_session_id_created_at_idx
  on public.gs_control_messages (session_id, created_at desc);
