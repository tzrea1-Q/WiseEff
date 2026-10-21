-- Keep message attribution, not the deleted file's name, checksum or storage key.
create table public.product_feedback_attachment_deletions (
  id uuid primary key,
  organization_id text not null references public.organizations(id),
  feedback_id uuid not null references public.product_feedback(id) on delete cascade,
  message_id uuid,
  uploaded_by_user_id text references public.users(id) on delete set null,
  deleted_by_user_id text references public.users(id) on delete set null,
  sort_order integer not null,
  created_at timestamptz not null,
  deleted_at timestamptz not null default now(),
  cleanup_upload_id uuid not null,
  foreign key(message_id,feedback_id,organization_id) references public.product_feedback_progress_events(id,feedback_id,organization_id) on delete cascade
);
create index product_feedback_attachment_deletions_feedback_idx on public.product_feedback_attachment_deletions(organization_id,feedback_id);
do $$ declare r record; begin
  for r in select rolname from pg_roles where has_table_privilege(oid,'public.product_feedback_attachments','INSERT') and rolname<>'PUBLIC' loop
    execute format('grant select,insert,update,delete on public.product_feedback_attachment_deletions to %I',r.rolname);
  end loop;
end $$;
