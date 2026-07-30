-- ADR-0010: attribution tree is taxonomy, not topology.
-- Retire instance/logical kinds; introduce node-type; bindings hang on
-- driver-group or node-type (or unclassified root) only.
--
-- Row-count checkpoints (record before/after in ops notes when applying to
-- seeded DBs): instance modules, logical modules, bindings on each, mappings.

-- ---------------------------------------------------------------------------
-- 1. Widen constraints so transitional kinds coexist
-- ---------------------------------------------------------------------------

alter table parameter_modules
  drop constraint if exists parameter_modules_kind_check;

alter table parameter_modules
  add constraint parameter_modules_kind_check
  check (kind in ('business', 'driver-group', 'instance', 'logical', 'node-type', 'unclassified'));

alter table parameter_module_mappings
  drop constraint if exists parameter_module_mappings_match_kind_check;

alter table parameter_module_mappings
  add constraint parameter_module_mappings_match_kind_check
  check (match_kind in ('compatible', 'instance', 'node-type'));

-- ---------------------------------------------------------------------------
-- 2. Re-point bindings on instance modules that sit under a driver-group parent
-- ---------------------------------------------------------------------------

update project_parameter_bindings b
set module_id = parent.id
from parameter_modules pm
inner join parameter_modules parent
  on parent.id = pm.parent_id
 and parent.organization_id = pm.organization_id
 and parent.kind = 'driver-group'
where b.module_id = pm.id
  and pm.kind = 'instance'
  and pm.name <> 'board';

-- Drop emptied device-instance modules that now live only under driver groups
delete from parameter_modules pm
where pm.kind = 'instance'
  and lower(pm.name) <> 'board'
  and exists (
    select 1
    from parameter_modules parent
    where parent.id = pm.parent_id
      and parent.kind = 'driver-group'
  )
  and not exists (select 1 from project_parameter_bindings b where b.module_id = pm.id)
  and not exists (select 1 from parameter_modules child where child.parent_id = pm.id)
  and not exists (select 1 from parameter_module_mappings m where m.parameter_module_id = pm.id);

-- board → node-type under Board Identity (or current parent if already business)
update parameter_modules
set
  kind = 'node-type',
  source_key = 'nodetype:board',
  name = 'board'
where kind = 'instance'
  and lower(name) = 'board';

-- ---------------------------------------------------------------------------
-- 3. Convert logical (+ remaining instance that are not under driver-group)
--    to node-type, keyed on bare node name
-- ---------------------------------------------------------------------------

-- Normalize display name: strip unit address for @hex / @decimal suffixes
with named as (
  select
    id,
    organization_id,
    parent_id,
    kind,
    name,
    source_key,
    lower(
      case
        when name ~ '@[0-9a-fA-F]+$' then regexp_replace(name, '@[0-9a-fA-F]+$', '')
        when name = '/' then 'board'
        else name
      end
    ) as bare_name
  from parameter_modules
  where kind in ('logical', 'instance')
    and lower(name) <> 'board'
),
-- Prefer existing nodetype:* winner; else keep lowest id per (org, bare_name)
winners as (
  select distinct on (organization_id, bare_name)
    id as winner_id,
    organization_id,
    bare_name
  from named
  order by
    organization_id,
    bare_name,
    case when source_key like 'nodetype:%' then 0 else 1 end,
    id
)
-- Repoint bindings from losers to winners
update project_parameter_bindings b
set module_id = w.winner_id
from named n
inner join winners w
  on w.organization_id = n.organization_id
 and w.bare_name = n.bare_name
where b.module_id = n.id
  and n.id <> w.winner_id;

-- Repoint children parents from losers to winners
with named as (
  select
    id,
    organization_id,
    lower(
      case
        when name ~ '@[0-9a-fA-F]+$' then regexp_replace(name, '@[0-9a-fA-F]+$', '')
        when name = '/' then 'board'
        else name
      end
    ) as bare_name
  from parameter_modules
  where kind in ('logical', 'instance')
    and lower(name) <> 'board'
),
winners as (
  select distinct on (organization_id, bare_name)
    id as winner_id,
    organization_id,
    bare_name
  from named
  order by organization_id, bare_name, id
)
update parameter_modules child
set parent_id = w.winner_id
from named n
inner join winners w
  on w.organization_id = n.organization_id
 and w.bare_name = n.bare_name
where child.parent_id = n.id
  and n.id <> w.winner_id;

-- Repoint mappings from losers to winners
with named as (
  select
    id,
    organization_id,
    lower(
      case
        when name ~ '@[0-9a-fA-F]+$' then regexp_replace(name, '@[0-9a-fA-F]+$', '')
        when name = '/' then 'board'
        else name
      end
    ) as bare_name
  from parameter_modules
  where kind in ('logical', 'instance')
    and lower(name) <> 'board'
),
winners as (
  select distinct on (organization_id, bare_name)
    id as winner_id,
    organization_id,
    bare_name
  from named
  order by organization_id, bare_name, id
)
update parameter_module_mappings m
set parameter_module_id = w.winner_id
from named n
inner join winners w
  on w.organization_id = n.organization_id
 and w.bare_name = n.bare_name
where m.parameter_module_id = n.id
  and n.id <> w.winner_id;

-- Promote winners to node-type with nodetype source_key and bare display name
with named as (
  select
    id,
    organization_id,
    lower(
      case
        when name ~ '@[0-9a-fA-F]+$' then regexp_replace(name, '@[0-9a-fA-F]+$', '')
        when name = '/' then 'board'
        else name
      end
    ) as bare_name
  from parameter_modules
  where kind in ('logical', 'instance')
    and lower(name) <> 'board'
),
winners as (
  select distinct on (organization_id, bare_name)
    id as winner_id,
    organization_id,
    bare_name
  from named
  order by organization_id, bare_name, id
)
update parameter_modules pm
set
  kind = 'node-type',
  name = w.bare_name,
  source_key = 'nodetype:' || w.bare_name
from winners w
where pm.id = w.winner_id;

-- Delete loser instance/logical rows (bindings/mappings already moved)
delete from parameter_modules pm
where pm.kind in ('logical', 'instance')
  and lower(pm.name) <> 'board'
  and not exists (
    select 1 from project_parameter_bindings b where b.module_id = pm.id
  )
  and not exists (
    select 1 from parameter_modules child where child.parent_id = pm.id
  )
  and not exists (
    select 1 from parameter_module_mappings m where m.parameter_module_id = pm.id
  );

-- Any remaining logical/instance (edge cases with bindings that couldn't merge)
-- force to node-type using bare name; collide by appending id suffix only if needed
update parameter_modules
set
  kind = 'node-type',
  name = lower(
    case
      when name ~ '@[0-9a-fA-F]+$' then regexp_replace(name, '@[0-9a-fA-F]+$', '')
      when name = '/' then 'board'
      else name
    end
  ),
  source_key = 'nodetype:' || lower(
    case
      when name ~ '@[0-9a-fA-F]+$' then regexp_replace(name, '@[0-9a-fA-F]+$', '')
      when name = '/' then 'board'
      else name
    end
  )
where kind in ('logical', 'instance');

-- Resolve source_key unique collisions after forced conversion: keep earliest, null others then delete empties
-- (unique index is partial on source_key is not null)
update parameter_modules pm
set source_key = null
where pm.kind = 'node-type'
  and pm.source_key is not null
  and exists (
    select 1
    from parameter_modules other
    where other.organization_id = pm.organization_id
      and other.source_key = pm.source_key
      and other.id < pm.id
  );

update parameter_modules
set source_key = 'nodetype:' || lower(name)
where kind = 'node-type'
  and source_key is null;

-- Second pass: still colliding? append short id
update parameter_modules pm
set source_key = 'nodetype:' || lower(pm.name) || ':' || substr(pm.id, greatest(length(pm.id) - 7, 1))
where pm.kind = 'node-type'
  and exists (
    select 1
    from parameter_modules other
    where other.organization_id = pm.organization_id
      and other.source_key = pm.source_key
      and other.id < pm.id
  );

-- ---------------------------------------------------------------------------
-- 4. Convert bare-name instance mappings → node-type; drop unit-addressed
-- ---------------------------------------------------------------------------

update parameter_module_mappings
set
  match_kind = 'node-type',
  match_value = lower(match_value)
where match_kind = 'instance'
  and match_value !~ '@';

delete from parameter_module_mappings
where match_kind = 'instance';

-- ---------------------------------------------------------------------------
-- 5. Scaffolding leaves the tree: re-park bindings on unclassified root, delete
-- ---------------------------------------------------------------------------

update project_parameter_bindings b
set module_id = unc.id
from parameter_modules pm
inner join parameter_modules unc
  on unc.organization_id = pm.organization_id
 and unc.kind = 'unclassified'
 and unc.name = '未分类'
 and unc.parent_id is null
where b.module_id = pm.id
  and pm.kind = 'node-type'
  and (
    pm.name ~* '^(spmi\d*|amba(-bus)?|i2c@[0-9a-fA-F]+|pmic@[0-9a-fA-F]+|gic(-v?\d+)?|gpio\d*|batt)$'
    or pm.name ~* '^i2c@[0-9a-fA-F]+$'
    or pm.name ~* '^pmic@[0-9a-fA-F]+$'
  );

delete from parameter_module_mappings m
using parameter_modules pm
where m.parameter_module_id = pm.id
  and pm.kind = 'node-type'
  and (
    pm.name ~* '^(spmi\d*|amba(-bus)?|gic(-v?\d+)?|gpio\d*|batt)$'
    or pm.name ~* '^i2c@[0-9a-fA-F]+$'
    or pm.name ~* '^pmic@[0-9a-fA-F]+$'
  );

delete from parameter_modules pm
where pm.kind = 'node-type'
  and (
    pm.name ~* '^(spmi\d*|amba(-bus)?|gic(-v?\d+)?|gpio\d*|batt)$'
    or pm.name ~* '^i2c@[0-9a-fA-F]+$'
    or pm.name ~* '^pmic@[0-9a-fA-F]+$'
  )
  and not exists (select 1 from project_parameter_bindings b where b.module_id = pm.id)
  and not exists (select 1 from parameter_modules child where child.parent_id = pm.id);

-- Delete emptied provisional unclassified buckets (未分类 · …)
delete from parameter_modules pm
where pm.kind = 'unclassified'
  and pm.name like '未分类 · %'
  and not exists (select 1 from project_parameter_bindings b where b.module_id = pm.id)
  and not exists (select 1 from parameter_modules child where child.parent_id = pm.id);

-- ---------------------------------------------------------------------------
-- 6. Narrow to final vocabulary
-- ---------------------------------------------------------------------------

-- Fail loudly if any instance/logical remain
do $$
begin
  if exists (select 1 from parameter_modules where kind in ('instance', 'logical')) then
    raise exception '0080: instance/logical modules remain after taxonomy cutover';
  end if;
  if exists (select 1 from parameter_module_mappings where match_kind = 'instance') then
    raise exception '0080: instance match mappings remain after taxonomy cutover';
  end if;
  if exists (
    select 1
    from project_parameter_bindings b
    inner join parameter_modules pm on pm.id = b.module_id
    where pm.kind = 'business'
  ) then
    raise exception '0080: bindings still point at business modules';
  end if;
end $$;

alter table parameter_modules
  drop constraint if exists parameter_modules_kind_check;

alter table parameter_modules
  add constraint parameter_modules_kind_check
  check (kind in ('business', 'driver-group', 'node-type', 'unclassified'));

alter table parameter_module_mappings
  drop constraint if exists parameter_module_mappings_match_kind_check;

alter table parameter_module_mappings
  add constraint parameter_module_mappings_match_kind_check
  check (match_kind in ('compatible', 'node-type'));
