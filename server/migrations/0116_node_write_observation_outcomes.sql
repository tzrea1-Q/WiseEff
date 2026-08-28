alter table node_operations
  add column if not exists write_outcome text,
  add column if not exists readback_outcome text,
  add column if not exists related_operation_id text references node_operations(id) on delete set null;

alter table node_operations
  alter column verified drop not null;

alter table node_operations
  drop constraint if exists node_operations_write_outcome_check,
  add constraint node_operations_write_outcome_check
    check (write_outcome is null or write_outcome in ('executed', 'failed', 'unknown')),
  drop constraint if exists node_operations_readback_outcome_check,
  add constraint node_operations_readback_outcome_check
    check (readback_outcome is null or readback_outcome in ('observed', 'failed', 'unsupported', 'not_requested', 'unknown'));

create index if not exists node_operations_related_operation_idx
  on node_operations(related_operation_id, created_at desc);
