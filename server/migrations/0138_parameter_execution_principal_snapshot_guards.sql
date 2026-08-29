-- Make the deleted-principal snapshot server-owned.  A tombstone-backed Agent
-- row may only be produced by the nested FK SET NULL transition performed by
-- account deletion; application inserts, replacements, removals, and
-- same-Organization substitutions must not be able to choose a principal.

create or replace function parameter_execution_identity_default_user()
returns trigger
language plpgsql
as $$
declare
  old_principal_user_id text;
  new_principal_user_id text;
  old_accountable_user_id text;
  new_accountable_user_id text;
  principal_organization_id text;
  nested_account_deletion boolean;
begin
  old_principal_user_id := to_jsonb(old)->>'initiator_principal_user_id';
  new_principal_user_id := to_jsonb(new)->>'initiator_principal_user_id';
  old_accountable_user_id := to_jsonb(old)->>tg_argv[0];
  new_accountable_user_id := to_jsonb(new)->>tg_argv[0];
  nested_account_deletion := new.initiator_type = 'agent'
    and new_accountable_user_id is null
    and old_accountable_user_id is not null
    and old_principal_user_id is null
    and new_principal_user_id is null
    and pg_trigger_depth() > 1;

  -- A retained tombstone is immutable and cannot be converted to another
  -- initiator type.  The only transition that may create a snapshot is the
  -- exact nested FK action below (live user -> NULL, no prior snapshot).
  if old_principal_user_id is not null
     and new.initiator_type <> 'agent' then
    raise exception 'Agent principal snapshots cannot change initiator type'
      using errcode = '23514';
  end if;
  if new_principal_user_id is distinct from old_principal_user_id
     and not nested_account_deletion then
    raise exception 'Agent principal snapshots are server-owned'
      using errcode = '23514';
  end if;

  if nested_account_deletion then
    if tg_table_name = 'project_parameter_file_versions' then
      select files.organization_id
      into principal_organization_id
      from project_parameter_files files
      where files.id = to_jsonb(new)->>'file_id';
    else
      principal_organization_id := to_jsonb(new)->>'organization_id';
    end if;
    insert into parameter_execution_principal_tombstones (principal_user_id, organization_id)
    values (old_accountable_user_id, principal_organization_id)
    on conflict (principal_user_id) do nothing;
    new.initiator_principal_user_id := old_accountable_user_id;
  elsif new.initiator_type in ('user', 'system', 'legacy') then
    new.initiator_principal_user_id := null;
  end if;

  -- Keep the historical User -> legacy conversion for account deletion.  It
  -- has no snapshot and therefore does not weaken the Agent-only transition.
  if new.initiator_type = 'user'
     and new_accountable_user_id is null
     and old_accountable_user_id is not null
     and pg_trigger_depth() > 1 then
    new.initiator_type := 'legacy';
    new.initiator_system_kind := null;
    new.initiator_system_name := null;
    new.initiator_session_id := null;
    new.initiator_tool_call_id := null;
    new.initiator_approval_id := null;
  end if;

  if new.initiator_type = 'legacy'
     and new_accountable_user_id is not null then
    new.initiator_type := 'user';
    new.initiator_principal_user_id := null;
  end if;

  if tg_table_name = 'project_parameter_file_versions'
     and new.initiator_principal_user_id is not null then
    select files.organization_id
    into principal_organization_id
    from project_parameter_files files
    where files.id = to_jsonb(new)->>'file_id';
    if not exists (
      select 1
      from parameter_execution_principal_tombstones tombstone
      where tombstone.principal_user_id = new.initiator_principal_user_id
        and tombstone.organization_id = principal_organization_id
    ) then
      raise exception 'Agent principal tombstone is outside the file Organization scope'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Include the snapshot column in every governed table's trigger.  The file
-- version also observes file_id because its Organization scope is inherited
-- from project_parameter_files rather than denormalized on the version row.
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
      'drop trigger if exists %I on %I',
      spec.table_name || '_execution_identity_default_user',
      spec.table_name
    );
    if spec.table_name = 'project_parameter_file_versions' then
      execute format(
        'create trigger %I
         before insert or update of initiator_type, %I,
           initiator_principal_user_id, file_id on %I
         for each row execute function parameter_execution_identity_default_user(%L)',
        spec.table_name || '_execution_identity_default_user',
        spec.user_column,
        spec.table_name,
        spec.user_column
      );
    else
      execute format(
        'create trigger %I
         before insert or update of initiator_type, %I,
           initiator_principal_user_id on %I
         for each row execute function parameter_execution_identity_default_user(%L)',
        spec.table_name || '_execution_identity_default_user',
        spec.user_column,
        spec.table_name,
        spec.user_column
      );
    end if;
  end loop;
end;
$$;
