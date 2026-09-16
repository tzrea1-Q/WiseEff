-- WiseEff Product Feedback Phase 2: data model extension, progress events, and resolution support.

alter table product_feedback
  add column if not exists submitted_at timestamptz null,
  add column if not exists resolution_code text null check (
    resolution_code is null or resolution_code in (
      'completed',
      'duplicate',
      'cannot_reproduce',
      'not_planned',
      'invalid',
      'other'
    )
  );

update product_feedback
set submitted_at = created_at
where submitted_at is null;

alter table product_feedback drop constraint if exists product_feedback_status_check;
alter table product_feedback add constraint product_feedback_status_check
  check (status in ('open', 'in_progress', 'resolved', 'closed'));

create index if not exists product_feedback_org_submitter_updated_idx
  on product_feedback (organization_id, submitter_user_id, updated_at desc);

create index if not exists product_feedback_org_status_updated_idx
  on product_feedback (organization_id, status, updated_at desc);

create table if not exists product_feedback_progress_events (
  id uuid primary key,
  organization_id text not null references organizations(id),
  feedback_id uuid not null references product_feedback(id) on delete cascade,
  actor_user_id text references users(id) on delete set null,
  kind text not null check (kind in ('submitted', 'status_changed', 'progress', 'reopened', 'legacy_note')),
  from_status text null check (from_status is null or from_status in ('open', 'in_progress', 'resolved', 'closed')),
  to_status text null check (to_status is null or to_status in ('open', 'in_progress', 'resolved', 'closed')),
  resolution_code text null check (
    resolution_code is null or resolution_code in (
      'completed',
      'duplicate',
      'cannot_reproduce',
      'not_planned',
      'invalid',
      'other'
    )
  ),
  public_message text null,
  internal_message text null,
  created_at timestamptz not null default now()
);

create index if not exists product_feedback_progress_events_feedback_created_idx
  on product_feedback_progress_events (feedback_id, created_at asc);

insert into product_feedback_progress_events (
  id, organization_id, feedback_id, actor_user_id, kind, from_status, to_status, internal_message, created_at
)
select
  gen_random_uuid(),
  organization_id,
  id,
  null,
  'legacy_note',
  null,
  null,
  admin_note,
  created_at
from product_feedback
where admin_note is not null
  and btrim(admin_note) <> ''
  and not exists (
    select 1
    from product_feedback_progress_events events
    where events.feedback_id = product_feedback.id
      and events.kind = 'legacy_note'
  );
