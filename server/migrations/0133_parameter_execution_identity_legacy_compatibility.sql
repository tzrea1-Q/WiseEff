-- Keep the trusted #614 projection strict while preserving pre-#614 rows that
-- have the historical `initiator_type = 'user'` default but no attribution.
-- Those rows carry no provenance metadata at all, so treating their nullable
-- user column as an unknown legacy value does not invent a System principal.
-- 0120 installs the strict checks as NOT VALID so upgrades can retain those
-- rows without opening a write-time legacy-null escape hatch. Reassert the
-- same predicate here; new and updated trusted rows remain bidirectionally
-- checked, while the explicit `legacy` marker remains for non-migrated paths.

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
