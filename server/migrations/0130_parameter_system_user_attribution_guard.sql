-- Prevent System execution metadata from carrying a user-owned attribution.
-- Kept as a follow-up migration after the 0129 provenance projection so the
-- ordered branch-only history remains explicit until it is merged.

alter table parameter_drafts
  add constraint parameter_drafts_system_user_null_check
    check (initiator_type <> 'system' or user_id is null);

alter table parameter_review_decisions
  add constraint parameter_review_decisions_system_user_null_check
    check (initiator_type <> 'system' or reviewer_user_id is null);

alter table parameter_history_entries
  add constraint parameter_history_entries_system_user_null_check
    check (initiator_type <> 'system' or changed_by_user_id is null);

alter table project_parameter_values
  add constraint project_parameter_values_system_user_null_check
    check (initiator_type <> 'system' or updated_by_user_id is null);

alter table project_parameter_file_versions
  add constraint project_parameter_file_versions_system_user_null_check
    check (initiator_type <> 'system' or created_by_user_id is null);

alter table project_parameter_file_candidates
  add constraint project_parameter_file_candidates_system_user_null_check
    check (initiator_type <> 'system' or created_by_user_id is null);

alter table dts_config_revisions
  add constraint dts_config_revisions_system_user_null_check
    check (initiator_type <> 'system' or created_by_user_id is null);
