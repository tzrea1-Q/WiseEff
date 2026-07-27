-- Batch 3: node-enablement drafts must become change requests so merge writeback
-- re-patches `status` from the change request write lock (ADR-0003).
-- Mirrors 0069 for change requests, submission items, and history.

alter table parameter_change_requests
  add column if not exists edit_subject_kind text not null default 'binding';

alter table parameter_change_requests
  drop constraint if exists parameter_change_requests_edit_subject_kind_check;

alter table parameter_change_requests
  add constraint parameter_change_requests_edit_subject_kind_check
  check (edit_subject_kind in ('binding', 'node-enablement'));

alter table parameter_change_requests
  add column if not exists logical_node_id text references dts_logical_nodes(id);

-- Enablement change requests store no binding; cutover left these columns NOT NULL.
alter table parameter_change_requests
  alter column project_parameter_binding_id drop not null;

alter table parameter_change_requests
  alter column parameter_spec_id drop not null;

alter table parameter_change_requests
  drop constraint if exists parameter_change_requests_enablement_subject_check;

alter table parameter_change_requests
  add constraint parameter_change_requests_enablement_subject_check
  check (
    (
      edit_subject_kind = 'binding'
      and project_parameter_binding_id is not null
    )
    or (
      edit_subject_kind = 'node-enablement'
      and logical_node_id is not null
      and project_parameter_binding_id is null
    )
  );

-- Open-request uniqueness for enablement mirrors the binding rule
-- (`findOpenChangeRequest` treats merged/rejected/withdrawn as closed).
create unique index if not exists parameter_change_requests_open_enablement_unique
  on parameter_change_requests (project_id, logical_node_id)
  where edit_subject_kind = 'node-enablement'
    and logical_node_id is not null
    and status not in ('merged', 'rejected', 'withdrawn');

alter table parameter_submission_items
  add column if not exists edit_subject_kind text not null default 'binding';

alter table parameter_submission_items
  drop constraint if exists parameter_submission_items_edit_subject_kind_check;

alter table parameter_submission_items
  add constraint parameter_submission_items_edit_subject_kind_check
  check (edit_subject_kind in ('binding', 'node-enablement'));

alter table parameter_submission_items
  add column if not exists logical_node_id text references dts_logical_nodes(id);

alter table parameter_submission_items
  alter column project_parameter_binding_id drop not null;

alter table parameter_submission_items
  drop constraint if exists parameter_submission_items_enablement_subject_check;

alter table parameter_submission_items
  add constraint parameter_submission_items_enablement_subject_check
  check (
    (
      edit_subject_kind = 'binding'
      and project_parameter_binding_id is not null
    )
    or (
      edit_subject_kind = 'node-enablement'
      and logical_node_id is not null
      and project_parameter_binding_id is null
    )
  );

-- Merged enablement changes still record history, keyed on the logical node.
alter table parameter_history_entries
  add column if not exists logical_node_id text references dts_logical_nodes(id);

alter table parameter_history_entries
  alter column project_parameter_binding_id drop not null;

create index if not exists parameter_history_entries_logical_node_idx
  on parameter_history_entries (logical_node_id)
  where logical_node_id is not null;
