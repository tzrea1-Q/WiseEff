-- Make the #614 domain projection bidirectional at the database boundary.
-- User/Agent rows must carry their authenticated accountable principal and no
-- System fields; System rows have no user attribution and must carry an
-- explicit service/job identity. These checks prevent a future write path from
-- silently changing an Agent/System execution into a User row.
--
-- The constraints are deliberately NOT VALID. Existing rows created before
-- #614 can have no historical user attribution (the 0128 `user` default), but
-- PostgreSQL still enforces the trusted User/Agent/System predicates for every
-- new row and every update. The explicit `legacy` marker preserves unrelated
-- pre-TD-068 writers until their own migration (#615); trusted #614 writers
-- always provide one of the three branded initiator types.

do $$
declare
  spec record;
begin
  create or replace function parameter_execution_identity_default_user()
  returns trigger
  language plpgsql
  as $fn$
  begin
    -- Existing non-#614 writers commonly provide a nullable creator but omit
    -- the new initiator columns. Keep a creator-bearing row's historical User
    -- meaning while reserving `legacy` for genuinely unprojected rows.
    if new.initiator_type = 'legacy'
       and (to_jsonb(new)->>tg_argv[0]) is not null then
      new.initiator_type := 'user';
    end if;
    return new;
  end;
  $fn$;

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
    execute format(
      'alter table %I alter column initiator_type set default ''legacy''',
      spec.table_name
    );
    execute format(
      'drop trigger if exists %I on %I',
      spec.table_name || '_execution_identity_default_user',
      spec.table_name
    );
    execute format(
      'create trigger %I
       before insert or update of initiator_type, %I on %I
       for each row execute function parameter_execution_identity_default_user(%L)',
      spec.table_name || '_execution_identity_default_user',
      spec.user_column,
      spec.table_name,
      spec.user_column
    );
    execute format(
      'alter table %I drop constraint if exists %I',
      spec.table_name,
      spec.table_name || '_initiator_type_check'
    );
    execute format(
      'alter table %I add constraint %I check (initiator_type in (''user'', ''agent'', ''system'', ''legacy''))',
      spec.table_name,
      spec.table_name || '_initiator_type_check'
    );
    execute format(
      'update %I
       set initiator_type = ''legacy''
       where initiator_type = ''user''
         and %I is null
         and initiator_system_kind is null
         and initiator_system_name is null
         and initiator_session_id is null
         and initiator_tool_call_id is null
         and initiator_approval_id is null',
      spec.table_name,
      spec.user_column
    );
    execute format(
      'alter table %I drop constraint if exists %I',
      spec.table_name,
      spec.table_name || '_execution_identity_check'
    );
    execute format(
      'alter table %I add constraint %I check (
        (
          initiator_type = ''system''
          and %I is null
          and initiator_system_kind in (''service'', ''job'')
          and initiator_system_name is not null
          and length(btrim(initiator_system_name)) > 0
        )
        or (
          initiator_type in (''user'', ''agent'')
          and %I is not null
          and initiator_system_kind is null
          and initiator_system_name is null
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
      spec.user_column
    );
  end loop;
end;
$$;

-- Binding revisions do not own a separate accountable-user column.  Their
-- current operation initiator is still persisted, and the parent draft/change
-- request carries the User/Agent principal.  Keep the initiator projection
-- truthful here rather than allowing System metadata on a User/Agent row.
alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_execution_identity_check;

alter table project_parameter_binding_revisions
  add constraint project_parameter_binding_revisions_execution_identity_check
  check (
    (
      initiator_type = 'system'
      and initiator_system_kind in ('service', 'job')
      and initiator_system_name is not null
      and length(btrim(initiator_system_name)) > 0
    )
    or (
      initiator_type in ('user', 'agent')
      and initiator_system_kind is null
      and initiator_system_name is null
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

alter table project_parameter_binding_revisions
  drop constraint if exists project_parameter_binding_revisions_initiator_type_check;

alter table project_parameter_binding_revisions
  add constraint project_parameter_binding_revisions_initiator_type_check
  check (initiator_type in ('user', 'agent', 'system', 'legacy'));

alter table project_parameter_binding_revisions
  alter column initiator_type set default 'legacy';

update project_parameter_binding_revisions
set initiator_type = 'legacy'
where initiator_type = 'user'
  and initiator_system_kind is null
  and initiator_system_name is null
  and initiator_session_id is null
  and initiator_tool_call_id is null
  and initiator_approval_id is null;
