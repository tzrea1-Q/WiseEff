-- Node-only runtime: link operations to debug_nodes catalog.

alter table node_operations
  add column if not exists node_id text references debug_nodes(id);

create index if not exists node_operations_node_id_idx
  on node_operations(node_id, created_at desc);
