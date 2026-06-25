alter table agent_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists agent_messages_metadata_gin_idx on agent_messages using gin (metadata);
