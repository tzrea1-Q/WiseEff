-- Add module grouping to logical debug_nodes catalog entries.

alter table debug_nodes
  add column if not exists module text not null default '';

update debug_nodes n
set module = coalesce(nullif(trim(p.module), ''), n.module)
from debugging_parameters p
where p.id = n.id
  and p.archived_at is null;
