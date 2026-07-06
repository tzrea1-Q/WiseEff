create table if not exists notification_outbox (
  id uuid primary key,
  organization_id text not null references organizations(id),
  idempotency_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  error_message text,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  dead_lettered_at timestamptz
);

create unique index if not exists notification_outbox_idempotency_idx
  on notification_outbox (idempotency_key);

create index if not exists notification_outbox_pending_idx
  on notification_outbox (created_at asc)
  where status in ('pending', 'retry');

create index if not exists notification_outbox_processing_lease_idx
  on notification_outbox (lease_expires_at)
  where status = 'processing';
