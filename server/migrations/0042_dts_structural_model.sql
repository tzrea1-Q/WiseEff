-- DTS structural model (P1): node tree / typed properties / phandle refs
-- Scoped to project_parameter_file_versions.id for coexistence with M1 flow.

create table if not exists dts_nodes (
  id text primary key,
  file_version_id text not null references project_parameter_file_versions(id) on delete cascade,
  parent_id text references dts_nodes(id) on delete cascade,
  name text not null,
  unit_address text,
  labels jsonb not null default '[]'::jsonb,
  ref_target text,
  is_overlay_root boolean not null default false,
  node_path text not null,
  compatible text,
  status text,
  sort_order integer not null default 0
);

create table if not exists dts_properties (
  id text primary key,
  node_id text not null references dts_nodes(id) on delete cascade,
  name text not null,
  value_type text not null,
  raw_text text not null,
  normalized_value text not null,
  sort_order integer not null default 0
);

create table if not exists dts_phandle_refs (
  id text primary key,
  from_property_id text not null references dts_properties(id) on delete cascade,
  target_label text not null,
  resolved_target_node_id text references dts_nodes(id)
);

create index if not exists dts_nodes_version_path_idx on dts_nodes(file_version_id, node_path);
create index if not exists dts_nodes_parent_idx on dts_nodes(parent_id, sort_order);
create index if not exists dts_properties_node_idx on dts_properties(node_id, name);
create index if not exists dts_nodes_compatible_idx on dts_nodes(file_version_id, compatible) where compatible is not null;
create index if not exists dts_phandle_refs_target_idx on dts_phandle_refs(target_label);
