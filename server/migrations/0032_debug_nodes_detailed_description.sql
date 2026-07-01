-- Split debug node description into brief summary and detailed description.

alter table debug_nodes
  add column if not exists detailed_description text not null default '';

update debug_nodes
set detailed_description = description
where trim(description) <> '';

update debug_nodes
set description = left(
  trim(split_part(replace(replace(description, E'\r\n', E'\n'), E'\r', E'\n'), E'\n', 1)),
  120
)
where trim(description) <> '';
