-- Hierarchical parameter module taxonomy (org-scoped tree).

create table if not exists parameter_modules (
  id text primary key,
  organization_id text not null references organizations(id),
  parent_id text references parameter_modules(id) on delete restrict,
  name text not null,
  path text not null,
  depth integer not null default 1,
  sort_order integer not null default 0,
  description text not null default '',
  scope text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parameter_modules_org_path_idx on parameter_modules (organization_id, path);
create index if not exists parameter_modules_org_parent_idx on parameter_modules (organization_id, parent_id, sort_order);

create unique index if not exists parameter_modules_org_parent_name_unique_idx
  on parameter_modules (organization_id, coalesce(parent_id, ''), name);

-- Backfill org-scoped root modules from distinct parameter definition and project module names.
insert into parameter_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
select
  'pmod-' || src.organization_id || '-' || md5(src.module_name),
  src.organization_id,
  null,
  src.module_name,
  'pmod-' || src.organization_id || '-' || md5(src.module_name),
  1,
  src.sort_order,
  '',
  ''
from (
  select distinct on (organization_id, module_name)
    organization_id,
    module_name,
    sort_order
  from (
    select
      organization_id,
      trim(module) as module_name,
      0 as sort_order
    from parameter_definitions
    where trim(module) <> ''
    union
    select
      organization_id,
      trim(name) as module_name,
      sort_order
    from project_modules
    where trim(name) <> ''
  ) names
  order by organization_id, module_name, sort_order
) src
on conflict (id) do nothing;

alter table parameter_definitions
  add column if not exists parameter_module_id text references parameter_modules(id);

update parameter_definitions pd
set parameter_module_id = pm.id
from parameter_modules pm
where pd.organization_id = pm.organization_id
  and trim(pd.module) = pm.name
  and pm.parent_id is null
  and pd.parameter_module_id is null;

create index if not exists parameter_definitions_parameter_module_id_idx
  on parameter_definitions (organization_id, parameter_module_id);

alter table project_modules
  add column if not exists parent_id text references parameter_modules(id) on delete restrict,
  add column if not exists path text,
  add column if not exists depth integer,
  add column if not exists parameter_module_id text references parameter_modules(id);

update project_modules pm
set
  parameter_module_id = org_pm.id,
  parent_id = null,
  path = org_pm.path,
  depth = org_pm.depth
from parameter_modules org_pm
where pm.organization_id = org_pm.organization_id
  and trim(pm.name) = org_pm.name
  and org_pm.parent_id is null
  and pm.parameter_module_id is null;
