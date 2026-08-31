create schema if not exists wayfinder_rehearsal;

create table wayfinder_rehearsal.relations (
  schema_name text not null,
  relation_name text not null,
  relation_kind text not null,
  persistence text not null
);

create table wayfinder_rehearsal.columns (
  schema_name text not null,
  relation_name text not null,
  ordinal_position integer not null,
  column_name text not null,
  data_type text not null,
  udt_name text not null,
  is_nullable text not null,
  has_default boolean not null,
  is_generated text not null,
  identity_generation text
);

create table wayfinder_rehearsal.constraints (
  schema_name text not null,
  relation_name text not null,
  constraint_name text not null,
  constraint_kind text not null,
  definition text not null,
  is_deferrable boolean not null,
  is_initially_deferred boolean not null,
  validated boolean not null
);

create table wayfinder_rehearsal.indexes (
  schema_name text not null,
  relation_name text not null,
  index_name text not null,
  definition text not null
);

create table wayfinder_rehearsal.triggers (
  schema_name text not null,
  relation_name text not null,
  trigger_name text not null,
  definition text not null,
  function_name text not null,
  enabled_mode text not null
);

create table wayfinder_rehearsal.migration_inventory (
  name text not null,
  checksum text not null
);

create table wayfinder_rehearsal.row_counts (
  relation_name text not null,
  row_count bigint not null check (row_count >= 0)
);

create table wayfinder_rehearsal.row_classes (
  family text not null,
  class_key text not null,
  row_count bigint not null check (row_count >= 0)
);

create table wayfinder_rehearsal.invariant_counts (
  metric_kind text not null,
  metric_name text not null,
  row_count bigint not null check (row_count >= 0),
  expectation text not null
);

create table wayfinder_rehearsal.manifest (
  key text not null,
  value text not null
);
