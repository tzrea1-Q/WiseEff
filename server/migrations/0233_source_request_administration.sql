-- Administrator cancellation preserves the frozen source and the actual review
-- signer. A new same-transaction human audit owns this pending transition.
-- Match the existing parameter policy: admin/platform-admin are organization
-- administration grants, while software-review grants retain their project scope.
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('parameter_catalog.protect_source_revision_request()'::regprocedure) into strict installed;
  changed:=replace(installed,
    'new.assigned_to_user_id is distinct from old.assigned_to_user_id and new.assigned_to_user_id is not null',
    'new.assigned_to_user_id is distinct from old.assigned_to_user_id and new.assigned_to_user_id is not null and not (old.status=''pending'' and new.status=''pending'' and old.source_revision_application_mode=''separate_review'')');
  if changed=installed then raise exception 'Frozen source assignment guard is unavailable'; end if;
  execute changed;
end $$;

create function parameter_catalog.protect_source_request_administration()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if old.request_kind<>'source_revision' then return new; end if;
  if old.status<>'pending' and (
    (to_jsonb(new)-array['submitter_user_id','assigned_to_user_id','reviewer_user_id'])
      is distinct from (to_jsonb(old)-array['submitter_user_id','assigned_to_user_id','reviewer_user_id'])
    or (new.reviewer_user_id is distinct from old.reviewer_user_id and new.reviewer_user_id is not null)) then
    raise exception using errcode='23514',message='Closed source request history is immutable';
  end if;
  if new.assigned_to_user_id is distinct from old.assigned_to_user_id and new.assigned_to_user_id is not null then
    if old.status<>'pending' or new.status<>'pending' or old.source_revision_application_mode<>'separate_review'
      or new.assigned_to_user_id=old.submitter_user_id
      or (to_jsonb(new)-array['assigned_to_user_id','updated_at']) is distinct from (to_jsonb(old)-array['assigned_to_user_id','updated_at'])
      or not exists(select 1 from public.audit_events audit
        join public.users administrator on administrator.id=audit.actor_user_id and administrator.organization_id=old.organization_id and administrator.is_active
        join public.users assignee on assignee.id=new.assigned_to_user_id and assignee.organization_id=old.organization_id and assignee.is_active
        where audit.organization_id=old.organization_id and audit.project_id=old.project_id and audit.target_id=old.id
          and audit.target_type='project-parameter-value-change-request' and audit.action='source-request-reassigned' and audit.actor_type='user'
          and audit.created_at=transaction_timestamp() and audit.metadata->>'proofDigest'=old.source_revision_proof_digest
          and audit.metadata->>'fromAssignedToUserId' is not distinct from old.assigned_to_user_id
          and audit.metadata->>'toAssignedToUserId'=new.assigned_to_user_id
          and exists(select 1 from public.user_role_bindings role where role.user_id=administrator.id and role.organization_id=old.organization_id
            and role.role_id in ('admin','platform-admin'))
          and exists(select 1 from public.user_role_bindings role where role.user_id=assignee.id and role.organization_id=old.organization_id
            and role.role_id in ('admin','platform-admin'))
          and exists(select 1 from public.user_role_bindings role where role.user_id=assignee.id and role.organization_id=old.organization_id
            and ((role.role_id='admin' and role.project_id is null) or (role.role_id='software-committer' and role.project_id=old.project_id)))) then
      raise exception using errcode='23514',message='Source reassignment requires its current administrator audit and eligible reviewer';
    end if;
  end if;
  if old.status='pending' and new.status='withdrawn' and new.reviewer_user_id is null then
    if old.source_revision_application_mode<>'separate_review'
      or (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at'])
      or not exists(select 1 from public.audit_events audit
        join public.users administrator on administrator.id=audit.actor_user_id and administrator.organization_id=old.organization_id and administrator.is_active
        where audit.organization_id=old.organization_id and audit.project_id=old.project_id and audit.target_id=old.id
          and audit.target_type='project-parameter-value-change-request' and audit.action='source-request-cancelled' and audit.actor_type='user'
          and audit.created_at=transaction_timestamp() and nullif(btrim(audit.metadata->>'reason'),'') is not null
          and audit.metadata->>'proofDigest'=old.source_revision_proof_digest
          and audit.metadata->>'fromAssignedToUserId' is not distinct from old.assigned_to_user_id
          and exists(select 1 from public.user_role_bindings role where role.user_id=administrator.id and role.organization_id=old.organization_id
            and role.role_id in ('admin','platform-admin'))) then
      raise exception using errcode='23514',message='Source cancellation requires its current administrator audit';
    end if;
  end if;
  return new;
end $$;
create trigger project_parameter_source_administration_immutable before update on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.protect_source_request_administration();
alter function parameter_catalog.protect_source_request_administration() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_source_request_administration() from public;
