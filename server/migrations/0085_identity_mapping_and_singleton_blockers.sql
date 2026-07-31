-- PR5: identity-mapping outcomes and singleton-per-project blocking tasks.

alter table identity_mapping_tasks
  drop constraint if exists identity_mapping_tasks_status_check;

alter table identity_mapping_tasks
  add constraint identity_mapping_tasks_status_check
  check (status in ('open', 'resolved', 'dismissed', 'new_identity'));

alter table identity_mapping_tasks
  add column if not exists task_kind text not null default 'identity-ambiguity';

alter table identity_mapping_tasks
  drop constraint if exists identity_mapping_tasks_task_kind_check;

alter table identity_mapping_tasks
  add constraint identity_mapping_tasks_task_kind_check
  check (task_kind in ('identity-ambiguity', 'singleton-cardinality'));

create unique index if not exists identity_mapping_singleton_blocker_idx
  on identity_mapping_tasks (config_revision_id, ((evidence->>'attributionSubjectId')))
  where task_kind = 'singleton-cardinality';
