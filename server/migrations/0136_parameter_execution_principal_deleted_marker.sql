-- Preserve Agent execution provenance after permanent account deletion without
-- retaining, copying, hashing, or otherwise re-materializing the deleted user id.
-- The live accountable-user foreign key is still nulled by 0117's SET NULL
-- policy.  This marker is an identity-free server-owned state bit; the Agent
-- correlation remains the durable evidence of the execution.

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('parameter_drafts'::text, 'user_id'::text),
      ('parameter_review_decisions'::text, 'reviewer_user_id'::text),
      ('parameter_history_entries'::text, 'changed_by_user_id'::text),
      ('project_parameter_values'::text, 'updated_by_user_id'::text),
      ('project_parameter_file_versions'::text, 'created_by_user_id'::text),
      ('project_parameter_file_candidates'::text, 'created_by_user_id'::text),
      ('dts_config_revisions'::text, 'created_by_user_id'::text),
      ('parameter_submission_rounds'::text, 'submitter_user_id'::text),
      ('parameter_change_requests'::text, 'submitter_user_id'::text)
    ) as t(table_name, user_column)
  loop
    execute format(
      'alter table %I add column if not exists initiator_principal_deleted boolean not null default false',
      spec.table_name
    );
  end loop;
end;
$$;

-- The only legal way to create a deleted Agent projection is the nested
-- foreign-key SET NULL update emitted while deleting the live accountable
-- user.  Direct inserts/updates cannot choose or clear the marker, and a
-- deleted Agent can never be converted to another initiator or re-attached to
-- a user.  Creator-bearing legacy defaults retain the historical narrow
-- legacy -> user adapter; malformed explicit rows are never rewritten.
create or replace function parameter_execution_identity_default_user()
returns trigger
language plpgsql
as $$
declare
  old_accountable_user_id text;
  new_accountable_user_id text;
  old_principal_deleted boolean := false;
  new_principal_deleted boolean := false;
  nested_account_deletion boolean := false;
begin
  new_accountable_user_id := to_jsonb(new)->>tg_argv[0];
  new_principal_deleted := coalesce((to_jsonb(new)->>'initiator_principal_deleted')::boolean, false);

  if tg_op = 'UPDATE' then
    old_accountable_user_id := to_jsonb(old)->>tg_argv[0];
    old_principal_deleted := coalesce((to_jsonb(old)->>'initiator_principal_deleted')::boolean, false);
    nested_account_deletion := pg_trigger_depth() > 1
      and old_accountable_user_id is not null
      and new_accountable_user_id is null
      and new.initiator_type = 'agent'
      and not old_principal_deleted
      and not new_principal_deleted;
  end if;

  if tg_op = 'INSERT' and new_principal_deleted then
    raise exception 'Deleted Agent principal marker is server-owned'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and old_principal_deleted is distinct from new_principal_deleted
     and not nested_account_deletion then
    raise exception 'Deleted Agent principal marker is server-owned'
      using errcode = '23514';
  end if;

  if old_principal_deleted
     and (new.initiator_type <> 'agent' or new_accountable_user_id is not null) then
    raise exception 'Deleted Agent principal cannot change initiator or regain a user principal'
      using errcode = '23514';
  end if;

  if nested_account_deletion then
    -- No value derived from old_accountable_user_id is persisted.  The marker
    -- records only that the Agent's accountable principal was deleted.
    new.initiator_principal_deleted := true;
  elsif new.initiator_type = 'user'
        and new_accountable_user_id is null
        and old_accountable_user_id is not null
        and pg_trigger_depth() > 1 then
    -- Historical User rows become metadata-free legacy rows on account
    -- deletion, matching the pre-#614 deletion contract.
    new.initiator_type := 'legacy';
    new.initiator_principal_deleted := false;
    new.initiator_system_kind := null;
    new.initiator_system_name := null;
    new.initiator_session_id := null;
    new.initiator_tool_call_id := null;
    new.initiator_approval_id := null;
  elsif new.initiator_type = 'legacy'
        and new_accountable_user_id is not null then
    -- Preserve the narrow historical creator-bearing default adapter.
    new.initiator_type := 'user';
    new.initiator_principal_deleted := false;
  end if;

  return new;
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('parameter_drafts'::text, 'user_id'::text),
      ('parameter_review_decisions'::text, 'reviewer_user_id'::text),
      ('parameter_history_entries'::text, 'changed_by_user_id'::text),
      ('project_parameter_values'::text, 'updated_by_user_id'::text),
      ('project_parameter_file_versions'::text, 'created_by_user_id'::text),
      ('project_parameter_file_candidates'::text, 'created_by_user_id'::text),
      ('dts_config_revisions'::text, 'created_by_user_id'::text),
      ('parameter_submission_rounds'::text, 'submitter_user_id'::text),
      ('parameter_change_requests'::text, 'submitter_user_id'::text)
    ) as t(table_name, user_column)
  loop
    execute format('drop trigger if exists %I on %I',
      spec.table_name || '_execution_identity_default_user', spec.table_name);
    execute format(
      'create trigger %I
       before insert or update of initiator_type, %I, initiator_principal_deleted
       on %I for each row
       execute function parameter_execution_identity_default_user(%L)',
      spec.table_name || '_execution_identity_default_user',
      spec.user_column,
      spec.table_name,
      spec.user_column
    );

    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_initiator_type_check');
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_system_identity_check');
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_system_user_null_check');
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_execution_identity_check');

    execute format(
      'alter table %I add constraint %I check (
        initiator_type in (''user'', ''agent'', ''system'', ''legacy'')
      )',
      spec.table_name,
      spec.table_name || '_initiator_type_check'
    );
    execute format(
      'alter table %I add constraint %I check ((
        (
          initiator_type = ''user''
          and %I is not null
          and initiator_principal_deleted = false
          and initiator_system_kind is null
          and initiator_system_name is null
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
        or (
          initiator_type = ''agent''
          and %I is not null
          and initiator_principal_deleted = false
          and initiator_session_id is not null
          and length(btrim(initiator_session_id)) > 0
          and initiator_tool_call_id is not null
          and length(btrim(initiator_tool_call_id)) > 0
          and initiator_approval_id is not null
          and length(btrim(initiator_approval_id)) > 0
          and initiator_system_kind is null
          and initiator_system_name is null
        )
        or (
          initiator_type = ''agent''
          and %I is null
          and initiator_principal_deleted = true
          and initiator_session_id is not null
          and length(btrim(initiator_session_id)) > 0
          and initiator_tool_call_id is not null
          and length(btrim(initiator_tool_call_id)) > 0
          and initiator_approval_id is not null
          and length(btrim(initiator_approval_id)) > 0
          and initiator_system_kind is null
          and initiator_system_name is null
        )
        or (
          initiator_type = ''system''
          and %I is null
          and initiator_principal_deleted = false
          and initiator_system_kind in (''service'', ''job'')
          and initiator_system_name is not null
          and length(btrim(initiator_system_name)) > 0
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
        or (
          initiator_type = ''legacy''
          and %I is null
          and initiator_principal_deleted = false
          and initiator_system_kind is null
          and initiator_system_name is null
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
      ) is true) not valid',
      spec.table_name,
      spec.table_name || '_execution_identity_check',
      spec.user_column,
      spec.user_column,
      spec.user_column,
      spec.user_column,
      spec.user_column
    );
  end loop;
end;
$$;

-- Binding revisions have no accountable-user column, so a deleted-principal
-- marker has no truthful transition to record there.  Their initiator metadata
-- still follows the same strict User/Agent/System/legacy union, and the marker
-- is fixed false so it cannot become an identity-free escape hatch.
alter table project_parameter_binding_revisions
  add column if not exists initiator_principal_deleted boolean not null default false;

alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_execution_identity_check;
alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_initiator_type_check;
alter table project_parameter_binding_revisions
  add constraint project_parameter_binding_revisions_initiator_type_check
  check (initiator_type in ('user', 'agent', 'system', 'legacy'));
alter table project_parameter_binding_revisions
  add constraint project_parameter_binding_revisions_execution_identity_check
  check ((
    initiator_principal_deleted = false
    and (
      (
        initiator_type = 'user'
        and initiator_system_kind is null
        and initiator_system_name is null
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null
      )
      or (
        initiator_type = 'agent'
        and initiator_session_id is not null
        and length(btrim(initiator_session_id)) > 0
        and initiator_tool_call_id is not null
        and length(btrim(initiator_tool_call_id)) > 0
        and initiator_approval_id is not null
        and length(btrim(initiator_approval_id)) > 0
        and initiator_system_kind is null
        and initiator_system_name is null
      )
      or (
        initiator_type = 'system'
        and initiator_system_kind in ('service', 'job')
        and initiator_system_name is not null
        and length(btrim(initiator_system_name)) > 0
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null
      )
      or (
        initiator_type = 'legacy'
        and initiator_system_kind is null
        and initiator_system_name is null
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null
      )
    )
  ) is true) not valid;
