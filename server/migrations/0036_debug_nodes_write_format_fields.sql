-- Admin-configurable write format example and hint for node debugging UI.

alter table debug_nodes
  add column if not exists write_format_example text not null default '',
  add column if not exists write_format_hint text not null default '';
