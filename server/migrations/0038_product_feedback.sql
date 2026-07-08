create table if not exists product_feedback (
  id uuid primary key,
  organization_id text not null references organizations(id),
  submitter_user_id text not null references users(id),
  page_path text not null,
  page_title text not null,
  feedback_type text not null check (feedback_type in ('experience', 'data', 'export_submit', 'feature')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_feedback_org_created_idx
  on product_feedback (organization_id, created_at desc, id desc);

create index if not exists product_feedback_org_status_idx
  on product_feedback (organization_id, status, created_at desc);

create table if not exists product_feedback_attachments (
  id uuid primary key,
  feedback_id uuid not null references product_feedback(id) on delete cascade,
  organization_id text not null references organizations(id),
  storage_key text not null,
  file_name text not null,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  checksum text not null,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists product_feedback_attachments_feedback_idx
  on product_feedback_attachments (feedback_id, sort_order);
