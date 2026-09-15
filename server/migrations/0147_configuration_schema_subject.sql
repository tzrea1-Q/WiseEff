-- Issue #849 PU-01 / ADR-0045 Slice B: storage closure for the third subject kind.
--
-- Append-only. 0137/0138 are not modified. Adds the canonical predicate, the
-- configuration-schema subtype relation, widens every closed kind/selector CHECK,
-- REDEFINES all six kind-dispatching trigger functions with a third arm (the
-- additive-trigger shortcut is refuted by the Spec review), and grants/owns the new
-- objects.
--
-- Placement decision: a configuration-schema subject places into a `business`
-- module (driver -> driver-group, node-type -> node-type). No change to the
-- immutable 0080 module-kind CHECK is required.
--
-- The predicate mirrors the TypeScript parser including its filename/extension
-- deny-list, so storage cannot accept an identity the contract refuses.

create table parameter_catalog.catalog_configuration_schemas (
  subject_id text primary key,
  foreign key (subject_id) references parameter_catalog.catalog_subjects(id)
    on delete restrict deferrable initially deferred
);

alter table parameter_catalog.catalog_subjects
  drop constraint catalog_subjects_kind_check;
alter table parameter_catalog.catalog_subjects
  add constraint catalog_subjects_kind_check
  check (kind in ('driver', 'node-type', 'configuration-schema'));

alter table parameter_catalog.catalog_subjects
  drop constraint catalog_subject_canonical_key_ck;
alter table parameter_catalog.catalog_subjects
  add constraint catalog_subject_canonical_key_ck check (
    -- CASE, not OR: SQL does not short-circuit `OR`, so an OR form would require
    -- every inserting role to hold EXECUTE on every kind's predicate. CASE evaluates
    -- only the matching branch, so a driver or node-type insert never touches the
    -- configuration-schema predicate.
    case kind
      when 'driver' then parameter_catalog.is_canonical_compatible_selector(canonical_key)
      when 'node-type' then parameter_catalog.is_canonical_node_type_name(canonical_key)
      when 'configuration-schema'
        then (
        canonical_key is not null
        and length(canonical_key) between 3 and 96
        and canonical_key ~ '^[A-Za-z0-9][A-Za-z0-9+._/-]*$'
        and position(',' in canonical_key) = 0
        and position('@' in canonical_key) = 0
        and position('*' in canonical_key) = 0
        and lower(canonical_key) !~ '\.(dts|dtsi|ya?ml|toml|env|json|csv|xlsx|ini|bin|txt|xml|conf)$'
      )
      else false
    end
  );

alter table parameter_catalog.catalog_subject_aliases
  drop constraint catalog_subject_aliases_selector_kind_check;
alter table parameter_catalog.catalog_subject_aliases
  add constraint catalog_subject_aliases_selector_kind_check
  check (selector_kind in ('driver-compatible', 'node-type-name', 'configuration-schema-id'));

alter table parameter_catalog.catalog_subject_aliases
  drop constraint catalog_subject_alias_selector_ck;
alter table parameter_catalog.catalog_subject_aliases
  add constraint catalog_subject_alias_selector_ck check (
    case selector_kind
      when 'driver-compatible'
        then parameter_catalog.is_canonical_compatible_selector(normalized_selector)
      when 'node-type-name'
        then parameter_catalog.is_canonical_node_type_name(normalized_selector)
      when 'configuration-schema-id'
        then (
        normalized_selector is not null
        and length(normalized_selector) between 3 and 96
        and normalized_selector ~ '^[A-Za-z0-9][A-Za-z0-9+._/-]*$'
        and position(',' in normalized_selector) = 0
        and position('@' in normalized_selector) = 0
        and position('*' in normalized_selector) = 0
        and lower(normalized_selector) !~ '\.(dts|dtsi|ya?ml|toml|env|json|csv|xlsx|ini|bin|txt|xml|conf)$'
      )
      else false
    end
  );

create or replace function parameter_catalog.reject_cross_root_selector_collision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  target_selector_kind text;
  target_selector_value text;
begin
  if tg_table_name = 'catalog_subjects' then
    target_selector_kind := case new.kind
      when 'driver' then 'driver-compatible'
      when 'node-type' then 'node-type-name'
      when 'configuration-schema' then 'configuration-schema-id'
    end;
    target_selector_value := new.canonical_key;
  else
    target_selector_kind := new.selector_kind;
    target_selector_value := new.normalized_selector;
  end if;

  -- Serialize both root tables through one transaction lock so opposite insert
  -- order and concurrent sessions observe one committed selector namespace.
  perform pg_catalog.pg_advisory_xact_lock(688005000001::bigint);

  if tg_table_name = 'catalog_subjects' and exists (
    select 1
    from parameter_catalog.catalog_subject_aliases alias
    where alias.selector_kind = target_selector_kind
      and alias.normalized_selector = target_selector_value
  ) then
    raise exception using
      errcode = '23505',
      message = 'Catalog canonical selector collides with an alias root',
      constraint = 'catalog_selector_cross_root_unique_ck';
  end if;

  if tg_table_name = 'catalog_subject_aliases' and exists (
    select 1
    from parameter_catalog.catalog_subjects subject
    where subject.kind = case target_selector_kind
        when 'driver-compatible' then 'driver'
        when 'node-type-name' then 'node-type'
        when 'configuration-schema-id' then 'configuration-schema'
      end
      and subject.canonical_key = target_selector_value
  ) then
    raise exception using
      errcode = '23505',
      message = 'Catalog alias collides with a canonical selector root',
      constraint = 'catalog_selector_cross_root_unique_ck';
  end if;

  return new;
end;
$$;

create or replace function parameter_catalog.assert_catalog_materialization_projection_complete()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if not exists (
    select 1
    from parameter_catalog.catalog_release_subjects
    where release_id = new.release_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog materialization has an empty release projection',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_releases release
    join parameter_catalog.catalog_release_subjects predecessor_subject
      on predecessor_subject.release_id = release.predecessor_release_id
    where release.id = new.release_id
      and not exists (
        select 1
        from parameter_catalog.catalog_release_subjects target_subject
        where target_subject.release_id = release.id
          and target_subject.subject_id = predecessor_subject.subject_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog materialization omits a predecessor subject',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_releases release
    join parameter_catalog.catalog_release_subject_aliases predecessor_alias
      on predecessor_alias.release_id = release.predecessor_release_id
    where release.id = new.release_id
      and not exists (
        select 1
        from parameter_catalog.catalog_release_subject_aliases target_alias
        where target_alias.release_id = release.id
          and target_alias.alias_id = predecessor_alias.alias_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog materialization omits a predecessor alias',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases release_alias
    join parameter_catalog.catalog_release_subjects release_subject
      on release_subject.release_id = release_alias.release_id
     and release_subject.subject_id = release_alias.subject_id
    where release_alias.release_id = new.release_id
      and release_alias.lifecycle = 'active'
      and release_subject.lifecycle <> 'active'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Active Catalog alias requires an active subject membership',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases release_alias
    join parameter_catalog.catalog_subject_aliases alias on alias.id = release_alias.alias_id
    join parameter_catalog.catalog_subjects subject on subject.id = alias.subject_id
    where release_alias.release_id = new.release_id
      and (
        (alias.selector_kind = 'driver-compatible' and subject.kind <> 'driver') or
        (alias.selector_kind = 'node-type-name' and subject.kind <> 'node-type') or
        (alias.selector_kind = 'configuration-schema-id'
          and subject.kind <> 'configuration-schema')
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog alias selector kind does not match its Subject kind',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases release_alias
    join parameter_catalog.catalog_subject_aliases alias on alias.id = release_alias.alias_id
    join parameter_catalog.catalog_subjects canonical_owner
      on canonical_owner.canonical_key = alias.normalized_selector
     and canonical_owner.kind = case alias.selector_kind
       when 'driver-compatible' then 'driver'
       when 'node-type-name' then 'node-type'
       when 'configuration-schema-id' then 'configuration-schema'
     end
    where release_alias.release_id = new.release_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog alias collides with another Subject canonical selector',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  if exists (
    with recursive target_lineage(id) as (
      select new.release_id
      union
      select release.predecessor_release_id
      from parameter_catalog.catalog_releases release
      join target_lineage lineage on lineage.id = release.id
      where release.predecessor_release_id is not null
    ),
    expected_definitions(definition_id) as (
      select distinct revision.definition_id
      from parameter_catalog.definition_revisions revision
      join target_lineage lineage on lineage.id = revision.catalog_release_id
    ),
    invalid_expected_definition as (
      select expected.definition_id
      from expected_definitions expected
      join parameter_catalog.parameter_definitions definition
        on definition.id = expected.definition_id
      left join parameter_catalog.catalog_release_definition_heads release_head
        on release_head.release_id = new.release_id
       and release_head.definition_id = expected.definition_id
      left join parameter_catalog.definition_revisions head_revision
        on head_revision.definition_id = release_head.definition_id
       and head_revision.id = release_head.revision_id
      left join target_lineage head_lineage
        on head_lineage.id = head_revision.catalog_release_id
      left join parameter_catalog.catalog_release_subjects release_subject
        on release_subject.release_id = new.release_id
       and release_subject.subject_id = definition.subject_id
      where release_head.definition_id is null
         or head_lineage.id is null
         or exists (
           select 1
           from parameter_catalog.definition_revisions newer_revision
           join target_lineage newer_lineage
             on newer_lineage.id = newer_revision.catalog_release_id
           where newer_revision.definition_id = expected.definition_id
             and newer_revision.revision_number > head_revision.revision_number
         )
         or release_subject.subject_id is null
    ),
    invalid_release_head as (
      select release_head.definition_id
      from parameter_catalog.catalog_release_definition_heads release_head
      join parameter_catalog.definition_revisions revision
        on revision.definition_id = release_head.definition_id
       and revision.id = release_head.revision_id
      left join expected_definitions expected
        on expected.definition_id = release_head.definition_id
      left join target_lineage revision_lineage
        on revision_lineage.id = revision.catalog_release_id
      where release_head.release_id = new.release_id
        and (expected.definition_id is null or revision_lineage.id is null)
    )
    select 1 from invalid_expected_definition
    union all
    select 1 from invalid_release_head
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog materialization definition heads are incomplete or split',
      constraint = 'catalog_materialization_projection_complete_ck';
  end if;

  return null;
end;
$$;

create or replace function parameter_catalog.assert_subject_has_exact_subtype()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  checked_subject_id text;
  subject_kind text;
  driver_count integer;
  node_type_count integer;
  configuration_schema_count integer;
begin
  if tg_table_name = 'catalog_subjects' then
    checked_subject_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    checked_subject_id := case when tg_op = 'DELETE' then old.subject_id else new.subject_id end;
  end if;

  select kind into subject_kind
  from parameter_catalog.catalog_subjects
  where id = checked_subject_id;

  if subject_kind is null then
    return null;
  end if;

  select count(*) into driver_count
  from parameter_catalog.catalog_drivers
  where subject_id = checked_subject_id;

  select count(*) into node_type_count
  from parameter_catalog.catalog_node_types
  where subject_id = checked_subject_id;

  select count(*) into configuration_schema_count
  from parameter_catalog.catalog_configuration_schemas
  where subject_id = checked_subject_id;

  if (subject_kind = 'driver'
        and (driver_count <> 1 or node_type_count <> 0 or configuration_schema_count <> 0))
     or (subject_kind = 'node-type'
        and (driver_count <> 0 or node_type_count <> 1 or configuration_schema_count <> 0))
     or (subject_kind = 'configuration-schema'
        and (driver_count <> 0 or node_type_count <> 0 or configuration_schema_count <> 1)) then
    raise exception using
      errcode = '23514',
      message = 'Catalog subject must have exactly one matching subtype',
      constraint = 'catalog_subject_exact_subtype_ck';
  end if;

  return null;
end;
$$;

create or replace function parameter_catalog.assert_current_release_complete()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  predecessor_id text;
begin
  select predecessor_release_id into predecessor_id
  from parameter_catalog.catalog_releases
  where id = new.current_catalog_release_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Current Catalog release does not exist',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  -- Bootstrap may install a complete root.  Every later pointer change must
  -- remain on the installed release's lineage: normal installation advances
  -- to a descendant, while the separately governed pre-traffic switch-back
  -- may select an ancestor.  A complete but independent root is neither.
  if tg_op = 'UPDATE'
     and old.current_catalog_release_id is distinct from new.current_catalog_release_id
     and not exists (
       with recursive target_lineage(id) as (
         select new.current_catalog_release_id
         union
         select release.predecessor_release_id
         from parameter_catalog.catalog_releases release
         join target_lineage lineage on lineage.id = release.id
         where release.predecessor_release_id is not null
       )
       select 1
       from target_lineage
       where id = old.current_catalog_release_id
     )
     and not exists (
       with recursive installed_lineage(id) as (
         select old.current_catalog_release_id
         union
         select release.predecessor_release_id
         from parameter_catalog.catalog_releases release
         join installed_lineage lineage on lineage.id = release.id
         where release.predecessor_release_id is not null
       )
       select 1
       from installed_lineage
       where id = new.current_catalog_release_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'Current Catalog release must share the installed release lineage',
      constraint = 'catalog_state_current_release_lineage_ck';
  end if;

  if exists (
    with recursive target_lineage(id) as (
      select new.current_catalog_release_id
      union
      select release.predecessor_release_id
      from parameter_catalog.catalog_releases release
      join target_lineage lineage on lineage.id = release.id
      where release.predecessor_release_id is not null
    )
    select 1
    from target_lineage lineage
    join parameter_catalog.catalog_releases release on release.id = lineage.id
    left join parameter_catalog.catalog_releases predecessor
      on predecessor.id = release.predecessor_release_id
    where release.predecessor_release_id is not null
      and (
        predecessor.id is null
        or release.release_sequence <> predecessor.release_sequence + 1
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Current Catalog release lineage must have gap-free sequences',
      constraint = 'catalog_state_current_release_lineage_ck';
  end if;

  if predecessor_id is not null and exists (
    select 1
    from parameter_catalog.catalog_release_subjects predecessor_subject
    where predecessor_subject.release_id = predecessor_id
      and not exists (
        select 1
        from parameter_catalog.catalog_release_subjects target_subject
        where target_subject.release_id = new.current_catalog_release_id
          and target_subject.subject_id = predecessor_subject.subject_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog release omits a predecessor subject',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  if predecessor_id is not null and exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases predecessor_alias
    where predecessor_alias.release_id = predecessor_id
      and not exists (
        select 1
        from parameter_catalog.catalog_release_subject_aliases target_alias
        where target_alias.release_id = new.current_catalog_release_id
          and target_alias.alias_id = predecessor_alias.alias_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog release omits a predecessor alias',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases release_alias
    join parameter_catalog.catalog_release_subjects release_subject
      on release_subject.release_id = release_alias.release_id
     and release_subject.subject_id = release_alias.subject_id
    where release_alias.release_id = new.current_catalog_release_id
      and release_alias.lifecycle = 'active'
      and release_subject.lifecycle <> 'active'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Active Catalog alias requires an active subject membership',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases release_alias
    join parameter_catalog.catalog_subject_aliases alias on alias.id = release_alias.alias_id
    join parameter_catalog.catalog_subjects subject on subject.id = alias.subject_id
    where release_alias.release_id = new.current_catalog_release_id
      and (
        (alias.selector_kind = 'driver-compatible' and subject.kind <> 'driver') or
        (alias.selector_kind = 'node-type-name' and subject.kind <> 'node-type') or
        (alias.selector_kind = 'configuration-schema-id'
          and subject.kind <> 'configuration-schema')
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog alias selector kind does not match its Subject kind',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  if exists (
    select 1
    from parameter_catalog.catalog_release_subject_aliases release_alias
    join parameter_catalog.catalog_subject_aliases alias on alias.id = release_alias.alias_id
    join parameter_catalog.catalog_subjects canonical_owner
      on canonical_owner.canonical_key = alias.normalized_selector
     and canonical_owner.kind = case alias.selector_kind
       when 'driver-compatible' then 'driver'
       when 'node-type-name' then 'node-type'
       when 'configuration-schema-id' then 'configuration-schema'
     end
    where release_alias.release_id = new.current_catalog_release_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog alias collides with another Subject canonical selector',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  if exists (
    with recursive target_lineage(id) as (
      select new.current_catalog_release_id
      union
      select release.predecessor_release_id
      from parameter_catalog.catalog_releases release
      join target_lineage lineage on lineage.id = release.id
      where release.predecessor_release_id is not null
    ),
    expected_definitions(definition_id) as (
      select distinct revision.definition_id
      from parameter_catalog.definition_revisions revision
      join target_lineage lineage on lineage.id = revision.catalog_release_id
    ),
    invalid_expected_definition as (
      select expected.definition_id
      from expected_definitions expected
      join parameter_catalog.parameter_definitions definition
        on definition.id = expected.definition_id
      left join parameter_catalog.catalog_release_definition_heads release_head
        on release_head.release_id = new.current_catalog_release_id
       and release_head.definition_id = expected.definition_id
      left join parameter_catalog.catalog_release_subjects release_subject
        on release_subject.release_id = new.current_catalog_release_id
       and release_subject.subject_id = definition.subject_id
      where release_head.definition_id is null
         or release_head.revision_id <> definition.current_revision_id
         or release_subject.subject_id is null
    ),
    invalid_release_head as (
      select release_head.definition_id
      from parameter_catalog.catalog_release_definition_heads release_head
      join parameter_catalog.definition_revisions revision
        on revision.definition_id = release_head.definition_id
       and revision.id = release_head.revision_id
      left join expected_definitions expected
        on expected.definition_id = release_head.definition_id
      left join target_lineage revision_lineage
        on revision_lineage.id = revision.catalog_release_id
      where release_head.release_id = new.current_catalog_release_id
        and (expected.definition_id is null or revision_lineage.id is null)
    )
    select 1 from invalid_expected_definition
    union all
    select 1 from invalid_release_head
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog release definition heads are incomplete or split',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  if not exists (
    select 1
    from parameter_catalog.catalog_materializations materialization
    where materialization.release_id = new.current_catalog_release_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog release materialization evidence is missing',
      constraint = 'catalog_state_current_release_complete_ck';
  end if;

  return null;
end;
$$;

create or replace function parameter_catalog.assert_subject_placement_kind()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  subject_kind text;
  module_kind text;
begin
  select subject.kind, module.kind
  into subject_kind, module_kind
  from parameter_catalog.organization_subject_registrations registration
  join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
  join public.parameter_modules module
    on module.id = new.module_id
   and module.organization_id = new.organization_id
  where registration.id = new.registration_id
    and registration.organization_id = new.organization_id;

  if subject_kind is null
     or (subject_kind = 'driver' and module_kind <> 'driver-group')
     or (subject_kind = 'node-type' and module_kind <> 'node-type')
     or (subject_kind = 'configuration-schema' and module_kind <> 'business') then
    raise exception using
      errcode = '23514',
      message = 'Subject placement kind does not match Catalog subject kind',
      constraint = 'subject_placement_kind_ck';
  end if;

  return null;
end;
$$;

create or replace function parameter_catalog.assert_parameter_module_placement_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if exists (
    select 1
    from parameter_catalog.subject_placements placement
    join parameter_catalog.organization_subject_registrations registration
      on registration.id = placement.registration_id
     and registration.organization_id = placement.organization_id
    join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
    where placement.module_id = new.id
      and placement.organization_id = new.organization_id
      and (
        (subject.kind = 'driver' and new.kind <> 'driver-group') or
        (subject.kind = 'node-type' and new.kind <> 'node-type') or
        (subject.kind = 'configuration-schema' and new.kind <> 'business')
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Parameter module kind does not match its retained Catalog Subject placement',
      constraint = 'subject_placement_kind_ck';
  end if;

  return null;
end;
$$;

-- Extend the cross-root guard to UPDATEs.
drop trigger if exists catalog_subject_selector_cross_root_unique on parameter_catalog.catalog_subjects;
create trigger catalog_subject_selector_cross_root_unique
before insert or update of kind, canonical_key on parameter_catalog.catalog_subjects
for each row execute function parameter_catalog.reject_cross_root_selector_collision();

drop trigger if exists catalog_subject_alias_selector_cross_root_unique on parameter_catalog.catalog_subject_aliases;
create trigger catalog_subject_alias_selector_cross_root_unique
before insert or update of selector_kind, normalized_selector
on parameter_catalog.catalog_subject_aliases
for each row execute function parameter_catalog.reject_cross_root_selector_collision();

create constraint trigger catalog_subject_exact_subtype_from_configuration_schema_ck
after insert or update or delete on parameter_catalog.catalog_configuration_schemas
deferrable initially deferred
for each row execute function parameter_catalog.assert_subject_has_exact_subtype();

-- Grants, mirroring 0138's predicate pattern exactly. SQL `OR` does not
-- short-circuit, so every role that inserts into catalog_subjects must be able to
-- execute the new predicate even when inserting a driver or node-type row.
alter table parameter_catalog.catalog_configuration_schemas owner to catalog_migration_owner;
grant select, insert on table parameter_catalog.catalog_configuration_schemas
  to catalog_synchronizer_role;

-- The configuration-schema predicate is inlined in the CHECK expressions above
-- rather than wrapped in a helper function. 0138 ends with a loop that revokes
-- EXECUTE on every function in parameter_catalog from catalog_synchronizer_role, so
-- a helper function would either need a grant that makes re-running 0138
-- non-idempotent (T3) or would break ordinary driver/node-type inserts. Inlining
-- keeps the storage guard and 0138's idempotency intact; SQL `OR` does not
-- short-circuit, which is why both CHECKs use an explicit `CASE`.
