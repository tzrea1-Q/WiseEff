-- Local device bridge persistence: registered bridge clients, auth tokens,
-- pairing codes, and debugging session/target linkage to bridge machines.

create table if not exists device_bridges (
  id text primary key,
  organization_id text not null,
  user_id text not null,
  machine_label text not null,
  platform text not null,
  arch text not null,
  client_version text,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists device_bridge_tokens (
  id text primary key,
  bridge_id text not null references device_bridges(id),
  token_hash text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists device_bridge_pairing_codes (
  id text primary key,
  organization_id text not null,
  user_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table debugging_sessions
  add column if not exists execution_mode text not null default 'server',
  add column if not exists bridge_id text,
  add column if not exists bridge_machine_label text;

alter table debugging_targets
  add column if not exists bridge_id text;
