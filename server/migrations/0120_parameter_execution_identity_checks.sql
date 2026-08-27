-- Make the #614 domain projection bidirectional at the database boundary.
-- User/Agent rows must carry their authenticated accountable principal and no
-- System fields; System rows have no user attribution and must carry an
-- explicit service/job identity.  These checks prevent a future write path
-- from silently changing an Agent/System execution into a User row.

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
      )',
      spec.table_name,
      spec.table_name || '_execution_identity_check',
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
  );
