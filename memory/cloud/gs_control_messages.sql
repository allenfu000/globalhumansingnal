create table if not exists public.gs_control_messages (
  session_id text not null,
  role text not null,
  content text not null,
  source text not null default 'gs-control',
  message_type text not null default 'normal_text',
  mode text not null default 'normal',
  attachments jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.gs_control_messages
  add column if not exists message_type text not null default 'normal_text';
alter table public.gs_control_messages
  add column if not exists mode text not null default 'normal';
alter table public.gs_control_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.gs_control_messages
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists gs_control_messages_session_id_created_at_idx
  on public.gs_control_messages (session_id, created_at desc);

create table if not exists public.gs_control_tasks (
  id bigserial primary key,
  session_id text not null,
  title text not null,
  status text not null default 'pending',
  task_content text not null,
  source text not null default 'gs-control',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gs_control_tasks_session_id_created_at_idx
  on public.gs_control_tasks (session_id, created_at desc);
