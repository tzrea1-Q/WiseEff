-- Historical attachments have no verifiable message/uploader association.
-- Leave them unassigned; new writes establish the association transactionally.
alter table public.product_feedback_progress_events add constraint product_feedback_message_owner_uq unique(id,feedback_id,organization_id);
alter table public.product_feedback_attachments
  add column message_id uuid,
  add column uploaded_by_user_id text references public.users(id) on delete set null,
  add constraint product_feedback_attachment_message_fk foreign key(message_id,feedback_id,organization_id)
    references public.product_feedback_progress_events(id,feedback_id,organization_id) on delete cascade;
create index product_feedback_attachments_message_idx on public.product_feedback_attachments(message_id);

-- A failed/uncertain upload keeps its exact physical keys until cleanup succeeds.
-- No feedback/message content is stored here. Active uploads hold their row lock.
create table public.product_feedback_attachment_uploads (
  id uuid primary key, organization_id text not null references public.organizations(id),
  uploaded_by_user_id text not null, object_keys text[] not null check(cardinality(object_keys)>0),
  created_at timestamptz not null default now()
);
create index product_feedback_uploads_owner_idx on public.product_feedback_attachment_uploads(organization_id,uploaded_by_user_id);
do $$ declare r record; begin
  for r in select rolname from pg_roles where has_table_privilege(oid,'public.product_feedback_attachments','INSERT') and rolname<>'PUBLIC' loop
    execute format('grant select,insert,update,delete on public.product_feedback_attachment_uploads to %I',r.rolname);
  end loop;
end $$;
