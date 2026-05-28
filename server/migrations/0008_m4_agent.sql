create table if not exists agent_sessions (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text,
  actor_user_id text not null references users(id),
  page_key text not null,
  role_id text,
  context jsonb not null,
  status text not null default 'active',
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_messages (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  organization_id text not null references organizations(id),
  role text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  confidence numeric,
  created_at timestamptz not null default now()
);

create table if not exists agent_tool_calls (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  organization_id text not null references organizations(id),
  project_id text,
  name text not null,
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  status text not null,
  result jsonb,
  error_message text,
  audit_event_id text references audit_events(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_approvals (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  tool_call_id text not null references agent_tool_calls(id) on delete cascade,
  organization_id text not null references organizations(id),
  project_id text,
  status text not null,
  title text not null,
  message text not null,
  requested_by_user_id text not null references users(id),
  decided_by_user_id text references users(id),
  decision_reason text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists agent_run_traces (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  message_id text references agent_messages(id) on delete set null,
  organization_id text not null references organizations(id),
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_summary text not null,
  output_summary text not null,
  tool_call_ids text[] not null default '{}',
  trace_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_sessions_context_scope_idx on agent_sessions(page_key, project_id, role_id, created_at desc);
create index if not exists agent_sessions_actor_idx on agent_sessions(actor_user_id, created_at desc);
create index if not exists agent_messages_session_idx on agent_messages(session_id, created_at asc);
create index if not exists agent_tool_calls_session_idx on agent_tool_calls(session_id, created_at asc);
create index if not exists agent_tool_calls_name_idx on agent_tool_calls(name, requires_approval, status);
create unique index if not exists agent_approvals_tool_call_unique_idx on agent_approvals(tool_call_id);
create index if not exists agent_approvals_session_status_idx on agent_approvals(session_id, status, requested_at desc);
create index if not exists agent_run_traces_session_idx on agent_run_traces(session_id, created_at desc);
