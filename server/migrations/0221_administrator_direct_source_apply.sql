-- A human administrator's own application is not a separate person's review.
alter table public.project_parameter_value_change_requests
  add column source_revision_application_mode text not null default 'separate_review',
  add constraint project_parameter_source_application_mode_ck check (
    source_revision_application_mode='separate_review'
    or (source_revision_application_mode='administrator_direct' and request_kind='source_revision'
      and assigned_to_user_id is null and reviewer_user_id is null)
  );

create function parameter_catalog.protect_source_application_mode()
returns trigger language plpgsql set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if new.source_revision_application_mode is distinct from old.source_revision_application_mode then
    raise exception using errcode='23514',message='Source application mode is immutable';
  end if;
  return new;
end $$;
create trigger project_parameter_source_application_mode_immutable before update
  on public.project_parameter_value_change_requests for each row
  execute function parameter_catalog.protect_source_application_mode();

create function parameter_catalog.assert_direct_source_application()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype;
begin
  select * into r from public.project_parameter_value_change_requests where id=new.id;
  if r.source_revision_application_mode='administrator_direct' and
    (r.status<>'approved' or not exists(select 1 from public.audit_events audit
      where audit.id=r.applied_audit_ref and audit.organization_id=r.organization_id
        and audit.project_id=r.project_id and audit.target_id=r.id and audit.action='value-change-applied'
        and audit.metadata->>'applicationMode'='administrator_direct'
        and nullif(audit.metadata->>'appliedByUserId','') is not null
        and (r.submitter_user_id is null or audit.metadata->>'appliedByUserId'=r.submitter_user_id))) then
    raise exception using errcode='23514',message='Direct source application requires its own committed administrator receipt';
  end if;
  return null;
end $$;
create constraint trigger project_parameter_direct_source_application_ck
  after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row
  when(new.source_revision_application_mode='administrator_direct')
  execute function parameter_catalog.assert_direct_source_application();

alter function parameter_catalog.protect_source_application_mode() owner to catalog_migration_owner;
alter function parameter_catalog.assert_direct_source_application() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_source_application_mode() from public;
revoke all on function parameter_catalog.assert_direct_source_application() from public;
