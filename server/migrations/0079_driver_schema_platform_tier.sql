-- ADR-0009: platform tier in driver schema overlays.
-- Renames overlay tables, nullable organization_id for platform rows,
-- superseded lifecycle, promotion provenance.

alter table organization_driver_schemas rename to driver_schema_overlays;

alter table organization_driver_schema_properties rename to driver_schema_overlay_properties;

alter table driver_schema_overlay_properties
  rename column organization_driver_schema_id to driver_schema_overlay_id;

alter index if exists organization_driver_schemas_org_compatible_active_uidx
  rename to driver_schema_overlays_org_compatible_active_uidx;

alter index if exists organization_driver_schemas_org_lifecycle_idx
  rename to driver_schema_overlays_org_lifecycle_idx;

alter index if exists organization_driver_schema_properties_schema_idx
  rename to driver_schema_overlay_properties_schema_idx;

alter index if exists organization_driver_schema_properties_spec_idx
  rename to driver_schema_overlay_properties_spec_idx;

alter index if exists organization_driver_schema_properties_schema_spec_uidx
  rename to driver_schema_overlay_properties_schema_spec_uidx;

alter table driver_schema_overlays alter column organization_id drop not null;

alter table driver_schema_overlays drop constraint if exists organization_driver_schemas_lifecycle_check;
alter table driver_schema_overlays drop constraint if exists driver_schema_overlays_lifecycle_check;

alter table driver_schema_overlays
  add constraint driver_schema_overlays_lifecycle_check
  check (lifecycle in ('draft', 'active', 'deprecated', 'superseded'));

alter table driver_schema_overlays
  add column if not exists superseded_by_schema_id text
    references driver_schema_overlays(id);

create unique index if not exists driver_schema_overlays_platform_compatible_active_uidx
  on driver_schema_overlays (lower(compatible))
  where lifecycle = 'active' and organization_id is null;

create table if not exists driver_schema_overlay_promotions (
  id text primary key,
  platform_schema_id text not null references driver_schema_overlays(id),
  source_schema_id text not null references driver_schema_overlays(id),
  source_organization_id text not null references organizations(id),
  promoted_by_user_id text references users(id),
  promoted_at timestamptz not null default now(),
  documentation_source text,
  unique (platform_schema_id, source_schema_id)
);

create index if not exists driver_schema_overlay_promotions_platform_idx
  on driver_schema_overlay_promotions (platform_schema_id, promoted_at desc);
