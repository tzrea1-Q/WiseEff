create table if not exists user_notifications (
  id uuid primary key,
  organization_id text not null references organizations(id),
  recipient_user_id text not null references users(id),
  category text not null,
  title text not null,
  body text not null,
  severity text not null default 'info',
  action_url text,
  source_kind text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists user_notifications_dedupe_idx
  on user_notifications (
    organization_id,
    recipient_user_id,
    coalesce(source_kind, ''),
    coalesce(source_id, ''),
    category
  );

create index if not exists user_notifications_recipient_unread_idx
  on user_notifications (recipient_user_id, created_at desc)
  where read_at is null;

create index if not exists user_notifications_recipient_created_idx
  on user_notifications (recipient_user_id, created_at desc);
