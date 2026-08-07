-- Persist CST source locators on structural nodes/properties for source-located navigation.
alter table dts_nodes
  add column if not exists start_offset integer,
  add column if not exists end_offset integer,
  add column if not exists start_line integer,
  add column if not exists start_column integer,
  add column if not exists end_line integer,
  add column if not exists end_column integer;

alter table dts_properties
  add column if not exists start_offset integer,
  add column if not exists end_offset integer,
  add column if not exists start_line integer,
  add column if not exists start_column integer,
  add column if not exists end_line integer,
  add column if not exists end_column integer;
