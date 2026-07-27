-- Module attribution redesign (ADR-0004 / ADR-0005):
-- state kind + origin + source_key on parameter_modules; retire driver match kind.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table parameter_modules
  add column if not exists kind text;

update parameter_modules
set kind = 'business'
where kind is null;

alter table parameter_modules
  alter column kind set default 'business';

alter table parameter_modules
  alter column kind set not null;

alter table parameter_modules
  drop constraint if exists parameter_modules_kind_check;

alter table parameter_modules
  add constraint parameter_modules_kind_check
  check (kind in ('business', 'driver-group', 'instance', 'unclassified'));

alter table parameter_modules
  add column if not exists origin text;

update parameter_modules
set origin = 'curated'
where origin is null;

alter table parameter_modules
  alter column origin set default 'curated';

alter table parameter_modules
  alter column origin set not null;

alter table parameter_modules
  drop constraint if exists parameter_modules_origin_check;

alter table parameter_modules
  add constraint parameter_modules_origin_check
  check (origin in ('curated', 'auto'));

alter table parameter_modules
  add column if not exists source_key text;

create unique index if not exists parameter_modules_org_source_key_unique_idx
  on parameter_modules (organization_id, source_key)
  where source_key is not null;

-- ---------------------------------------------------------------------------
-- Backfill kind / origin / source_key (order matters; later branches skip claimed rows)
-- ---------------------------------------------------------------------------

-- (1) compatible-targeted → driver-group / auto
update parameter_modules pm
set
  kind = 'driver-group',
  origin = 'auto',
  source_key = 'compatible:' || lower(m.match_value)
from parameter_module_mappings m
where m.parameter_module_id = pm.id
  and m.match_kind = 'compatible'
  and pm.kind = 'business'
  and pm.origin = 'curated';

-- (2) instance-targeted → instance / auto
update parameter_modules pm
set
  kind = 'instance',
  origin = 'auto'
where pm.kind = 'business'
  and pm.origin = 'curated'
  and exists (
    select 1
    from parameter_module_mappings m
    where m.parameter_module_id = pm.id
      and m.match_kind = 'instance'
  );

-- (3) 未分类 family → unclassified / auto
update parameter_modules
set
  kind = 'unclassified',
  origin = 'auto'
where kind = 'business'
  and origin = 'curated'
  and name like '未分类%';

-- (4) remaining address / scaffolding names → instance / auto
update parameter_modules
set
  kind = 'instance',
  origin = 'auto'
where kind = 'business'
  and origin = 'curated'
  and (
    name ~ '@[0-9a-fA-F]+'
    or name ~* '^(i2c|spi|pmic|batt|scharger)([@_0-9a-z]*)$'
  );

-- Best-effort source_key for instance modules from binding → latest node revision.
-- Prefer a single deterministic locator per module (min) to avoid unique collisions.
update parameter_modules pm
set source_key = keyed.source_key
from (
  select
    b.module_id,
    'node:' || case
      when min(lnr.node_locator) is null or min(lnr.node_locator) = '/' then ''
      when min(lnr.node_locator) like '/%' then substr(min(lnr.node_locator), 2)
      else min(lnr.node_locator)
    end as source_key
  from project_parameter_bindings b
  left join lateral (
    select node_locator
    from dts_logical_node_revisions
    where logical_node_id = b.logical_node_id
    order by config_revision_id desc
    limit 1
  ) lnr on true
  where lnr.node_locator is not null
  group by b.module_id
) keyed
where pm.id = keyed.module_id
  and pm.kind = 'instance'
  and pm.source_key is null
  and keyed.source_key is not null
  and keyed.source_key <> 'node:'
  and not exists (
    select 1
    from parameter_modules other
    where other.organization_id = pm.organization_id
      and other.source_key = keyed.source_key
      and other.id <> pm.id
  );

-- ---------------------------------------------------------------------------
-- Retire driver match kind (ADR-0005)
-- ---------------------------------------------------------------------------

delete from parameter_module_mappings
where match_kind = 'driver';

alter table parameter_module_mappings
  drop constraint if exists parameter_module_mappings_match_kind_check;

alter table parameter_module_mappings
  add constraint parameter_module_mappings_match_kind_check
  check (match_kind in ('compatible', 'instance'));
