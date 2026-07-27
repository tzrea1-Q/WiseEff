-- Batch 3: node-enablement drafts share the parameter draft tip pipeline (ADR-0003).
-- Binding drafts keep project_parameter_binding_id; enablement drafts key on logical_node_id.

alter table parameter_drafts
  add column if not exists edit_subject_kind text not null default 'binding';

alter table parameter_drafts
  drop constraint if exists parameter_drafts_edit_subject_kind_check;

alter table parameter_drafts
  add constraint parameter_drafts_edit_subject_kind_check
  check (edit_subject_kind in ('binding', 'node-enablement'));

alter table parameter_drafts
  add column if not exists logical_node_id text references dts_logical_nodes(id);

-- Enablement drafts store no binding; cutover left this column NOT NULL.
alter table parameter_drafts
  alter column project_parameter_binding_id drop not null;

-- Replace the cutover-era unique that assumed every draft has a binding.
-- Names seen in the wild: auto UNIQUE name, cutover key, and a prior partial index attempt.
alter table parameter_drafts
  drop constraint if exists parameter_drafts_project_id_project_parameter_binding_id_user_id_key;

alter table parameter_drafts
  drop constraint if exists parameter_drafts_project_binding_user_key;

drop index if exists parameter_drafts_project_binding_user_unique;
drop index if exists parameter_drafts_project_binding_user_key;

create unique index if not exists parameter_drafts_binding_user_unique
  on parameter_drafts (project_id, project_parameter_binding_id, user_id)
  where edit_subject_kind = 'binding'
    and project_parameter_binding_id is not null;

create unique index if not exists parameter_drafts_enablement_user_unique
  on parameter_drafts (project_id, logical_node_id, user_id)
  where edit_subject_kind = 'node-enablement'
    and logical_node_id is not null;

alter table parameter_drafts
  drop constraint if exists parameter_drafts_enablement_subject_check;

alter table parameter_drafts
  add constraint parameter_drafts_enablement_subject_check
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
