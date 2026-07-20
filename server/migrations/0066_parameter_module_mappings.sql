-- Additive: importance on the existing v1 parameter_modules tree (0039),
-- plus DTS driver/compatible/instance → module mappings for the workbench.
-- Does NOT recreate parameter_modules; that table already exists.

alter table parameter_modules
  add column if not exists importance text not null default 'medium'
    check (importance in ('high', 'medium', 'low'));

create table if not exists parameter_module_mappings (
  id text primary key,
  organization_id text not null references organizations(id),
  parameter_module_id text not null references parameter_modules(id) on delete cascade,
  match_kind text not null check (match_kind in ('driver', 'compatible', 'instance')),
  match_value text not null,
  priority integer not null default 0
    check (priority >= 0 and priority <= 999),
  created_at timestamptz not null default now(),
  unique (organization_id, match_kind, match_value)
);

create index if not exists parameter_module_mappings_org_idx
  on parameter_module_mappings (organization_id);

create index if not exists parameter_module_mappings_module_idx
  on parameter_module_mappings (parameter_module_id);
