-- Tighten the #614 execution projection into a database-enforced
-- discriminated union.  0132/0133 intentionally left some correlation
-- combinations open while preserving pre-TD-068 rows; this forward migration
-- keeps those historical rows (NOT VALID) but rejects every malformed new or
-- updated row.  #615 owns the eventual legacy backfill/ratchet.

-- Reassert the tiny historical adapter so an environment that reached the
-- earlier #614 identity checks can still replay this migration.
create or replace function parameter_execution_identity_default_user()
returns trigger
language plpgsql
as $$
begin
  -- A retained User row may lose its foreign-key principal when the account
  -- is permanently deleted.  PostgreSQL performs the FK SET NULL action via
  -- a nested trigger invocation; convert that historical attribution to the
  -- explicit metadata-free legacy variant before the check constraint sees
  -- the row.  Direct application updates remain strict because they run at
  -- trigger depth one and therefore cannot use this deletion-only adapter.
  if new.initiator_type = 'user'
     and (to_jsonb(new)->>tg_argv[0]) is null
     and (to_jsonb(old)->>tg_argv[0]) is not null
     and pg_trigger_depth() > 1 then
    new.initiator_type := 'legacy';
    new.initiator_system_kind := null;
    new.initiator_system_name := null;
    new.initiator_session_id := null;
    new.initiator_tool_call_id := null;
    new.initiator_approval_id := null;
  end if;
  if new.initiator_type = 'legacy'
     and (to_jsonb(new)->>tg_argv[0]) is not null then
    new.initiator_type := 'user';
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
      ('dts_config_revisions'::text, 'created_by_user_id'::text)
    ) as t(table_name, user_column)
  loop
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_execution_identity_check');
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_system_identity_check');
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_system_user_null_check');
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_initiator_type_check');
    execute format(
      'alter table %I add constraint %I check (
        initiator_type in (''user'', ''agent'', ''system'', ''legacy'')
      )',
      spec.table_name,
      spec.table_name || '_initiator_type_check'
    );
    execute format(
      'alter table %I add constraint %I check (
        (
          initiator_type = ''user''
          and %I is not null
          and initiator_system_kind is null
          and initiator_system_name is null
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
        or (
          initiator_type = ''agent''
          and %I is not null
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
          and initiator_system_kind is not null
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
          and initiator_system_kind is null
          and initiator_system_name is null
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
      ) not valid',
      spec.table_name,
      spec.table_name || '_execution_identity_check',
      spec.user_column,
      spec.user_column,
      spec.user_column,
      spec.user_column
    );
  end loop;
end;
$$;

-- Binding revisions carry the initiator projection but no accountable-user
-- column.  Apply the same union without inventing a principal column.
alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_execution_identity_check;
alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_system_identity_check;
alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_initiator_type_check;

alter table project_parameter_binding_revisions
  add constraint project_parameter_binding_revisions_initiator_type_check
  check (initiator_type in ('user', 'agent', 'system', 'legacy'));

alter table project_parameter_binding_revisions
  add constraint project_parameter_binding_revisions_execution_identity_check
  check (
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
      and initiator_system_kind is not null
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
  ) not valid;

-- Submission rounds and change requests gained the same fields in 0130 but
-- did not yet carry the legacy marker.  Install the narrow historical adapter
-- used by the earlier identity-compatibility step: a legacy row with a creator remains an explicit User row;
-- only a metadata-free row may remain legacy.  No malformed User/Agent/System
-- row is rewritten into legacy.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['parameter_submission_rounds', 'parameter_change_requests'] loop
    execute format('alter table %I alter column initiator_type set default ''legacy''', table_name);
    execute format('drop trigger if exists %I on %I',
      table_name || '_execution_identity_default_user', table_name);
    execute format(
      'create trigger %I
       before insert or update of initiator_type, submitter_user_id on %I
       for each row execute function parameter_execution_identity_default_user(%L)',
      table_name || '_execution_identity_default_user',
      table_name,
      'submitter_user_id'
    );
    execute format('alter table %I drop constraint if exists %I',
      table_name, table_name || '_initiator_type_check');
    execute format('alter table %I drop constraint if exists %I',
      table_name, table_name || '_system_identity_check');
    execute format('alter table %I add constraint %I check (
      initiator_type in (''user'', ''agent'', ''system'', ''legacy'')
    )', table_name, table_name || '_initiator_type_check');
    -- The earlier checks do not know the historical marker. Remove them
    -- before converting only metadata-free rows; malformed explicit
    -- User/Agent/System rows are never rewritten into legacy.
    execute format('update %I
      set initiator_type = ''legacy''
      where initiator_type = ''user''
        and submitter_user_id is null
        and initiator_system_kind is null
        and initiator_system_name is null
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null', table_name);
    execute format('alter table %I add constraint %I check (
      (
        initiator_type = ''user''
        and submitter_user_id is not null
        and initiator_system_kind is null
        and initiator_system_name is null
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null
      )
      or (
        initiator_type = ''agent''
        and submitter_user_id is not null
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
        and submitter_user_id is null
        and initiator_system_kind is not null
        and initiator_system_kind in (''service'', ''job'')
        and initiator_system_name is not null
        and length(btrim(initiator_system_name)) > 0
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null
      )
      or (
        initiator_type = ''legacy''
        and submitter_user_id is null
        and initiator_system_kind is null
        and initiator_system_name is null
        and initiator_session_id is null
        and initiator_tool_call_id is null
        and initiator_approval_id is null
      )
    ) not valid', table_name, table_name || '_execution_identity_check');
  end loop;
end;
$$;
