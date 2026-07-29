-- ADR-0008: organization-scoped manual driver schema overlay.
-- Exact compatible + property definitions merge into SchemaRegistry as the
-- lowest releasable tier. Pinned schemas/dts stays repository-managed.

create table if not exists organization_driver_schemas (
  id text primary key,
  organization_id text not null references organizations(id),
  compatible text not null,
  display_name text not null,
  notes text not null default '',
  lifecycle text not null check (lifecycle in ('draft', 'active', 'deprecated')),
  version integer not null default 1 check (version >= 1),
  created_by_user_id text references users(id),
  updated_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  check (trim(compatible) <> '')
);

create unique index if not exists organization_driver_schemas_org_compatible_active_uidx
  on organization_driver_schemas (organization_id, lower(compatible))
  where lifecycle = 'active';

create index if not exists organization_driver_schemas_org_lifecycle_idx
  on organization_driver_schemas (organization_id, lifecycle, updated_at desc);

create table if not exists organization_driver_schema_properties (
  id text primary key,
  organization_driver_schema_id text not null
    references organization_driver_schemas(id) on delete cascade,
  parameter_spec_id text not null references parameter_specs(id),
  property_key text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_driver_schema_id, property_key),
  unique (organization_driver_schema_id, parameter_spec_id),
  check (trim(property_key) <> '')
);

create index if not exists organization_driver_schema_properties_schema_idx
  on organization_driver_schema_properties (organization_driver_schema_id, sort_order, property_key);

create index if not exists organization_driver_schema_properties_spec_idx
  on organization_driver_schema_properties (parameter_spec_id);
