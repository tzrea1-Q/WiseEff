-- Batch 4 closeout: allow legacy PPV-backed binding rows to keep a null
-- project_parameter_binding_id until identity migration backfills it.
-- Discriminator is edit_subject_kind + logical_node_id (ADR-0003).
-- Idempotent for databases that already applied the stricter 0069/0070 checks.

alter table parameter_drafts
  drop constraint if exists parameter_drafts_enablement_subject_check;

alter table parameter_drafts
  add constraint parameter_drafts_enablement_subject_check
  check (
    (
      edit_subject_kind = 'binding'
      and logical_node_id is null
    )
    or (
      edit_subject_kind = 'node-enablement'
      and logical_node_id is not null
      and project_parameter_binding_id is null
    )
  );

alter table parameter_change_requests
  drop constraint if exists parameter_change_requests_enablement_subject_check;

alter table parameter_change_requests
  add constraint parameter_change_requests_enablement_subject_check
  check (
    (
      edit_subject_kind = 'binding'
      and logical_node_id is null
    )
    or (
      edit_subject_kind = 'node-enablement'
      and logical_node_id is not null
      and project_parameter_binding_id is null
    )
  );

alter table parameter_submission_items
  drop constraint if exists parameter_submission_items_enablement_subject_check;

alter table parameter_submission_items
  add constraint parameter_submission_items_enablement_subject_check
  check (
    (
      edit_subject_kind = 'binding'
      and logical_node_id is null
    )
    or (
      edit_subject_kind = 'node-enablement'
      and logical_node_id is not null
      and project_parameter_binding_id is null
    )
  );
