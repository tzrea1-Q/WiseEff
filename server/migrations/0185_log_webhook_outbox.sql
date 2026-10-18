-- Durable result events are independent of the retained per-attempt API history.
alter table log_domains add column webhook_secret_last_four text;

create table log_webhook_outbox (
  id text primary key,
  organization_id text not null references organizations(id),
  log_domain_id text not null,
  log_record_id text not null,
  run_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, run_id),
  foreign key (log_domain_id, organization_id) references log_domains(id, organization_id) on delete cascade,
  foreign key (log_record_id, organization_id) references log_records(id, organization_id) on delete cascade
);
create index log_webhook_outbox_due_idx on log_webhook_outbox (next_attempt_at, id)
  where status in ('pending', 'retry', 'processing');
