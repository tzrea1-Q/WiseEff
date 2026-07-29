-- ADR-0008 alignment: overlay properties reference ParameterSpec rows instead of
-- storing a parallel valueShape/units/documentation copy.

alter table organization_driver_schema_properties
  add column if not exists parameter_spec_id text references parameter_specs(id);

-- Prior inline definition rows are not auto-migrated; clear them so Admins
-- re-author by linking (or creating) ParameterSpec definitions.
delete from organization_driver_schema_properties
where parameter_spec_id is null;

alter table organization_driver_schema_properties
  drop column if exists value_shape,
  drop column if exists units,
  drop column if exists constraints,
  drop column if exists example_value,
  drop column if exists documentation;

alter table organization_driver_schema_properties
  alter column parameter_spec_id set not null;

create unique index if not exists organization_driver_schema_properties_schema_spec_uidx
  on organization_driver_schema_properties (organization_driver_schema_id, parameter_spec_id);

create index if not exists organization_driver_schema_properties_spec_idx
  on organization_driver_schema_properties (parameter_spec_id);
