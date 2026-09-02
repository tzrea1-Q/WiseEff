-- Wayfinder #668 / Issue #688 (S2-SCH): canonical parameter Catalog schema.
--
-- The existing public parameter tables remain the legacy, old-binary-compatible
-- model until the bounded cutover.  Canonical relations use their normative
-- physical names inside the dedicated parameter_catalog schema so both models
-- can coexist during expand/migrate/contract.

create schema parameter_catalog;

create function parameter_catalog.reject_immutable_catalog_change()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
end;
$$;

create function parameter_catalog.acquire_current_pointer_lock_exclusive()
returns void
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  previous_lock_timeout text;
begin
  previous_lock_timeout := pg_catalog.current_setting('lock_timeout');
  perform pg_catalog.set_config('lock_timeout', '2s', true);
  begin
    perform pg_catalog.pg_advisory_xact_lock(688004000041::bigint);
  exception
    when lock_not_available then
      perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
      raise exception using
        errcode = 'PCA05',
        message = 'catalog current-pointer serialization timed out',
        detail = 'PCAT-GUARD-SYNCHRONIZATION-BUSY';
  end;
  perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
end;
$$;

revoke all on function parameter_catalog.acquire_current_pointer_lock_exclusive() from public;

-- These predicates mirror the byte-preserving S0-ID parsers. They validate
-- stored identity bytes; they never trim, fold case, normalize Unicode, strip
-- quotes, remove unit addresses, or otherwise rewrite caller input.
create function parameter_catalog.is_canonical_compatible_selector(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
return value ~ '^[A-Za-z0-9][A-Za-z0-9+._/-]*(,[A-Za-z0-9][A-Za-z0-9+._/-]*)?$';

create function parameter_catalog.is_canonical_node_type_name(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
return value = '/' or value ~ '^[A-Za-z][A-Za-z0-9,._+-]{0,30}$';

create function parameter_catalog.is_canonical_property_key(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
return value ~ '^[A-Za-z0-9,._+?#-]{1,31}$'
  and left(value, 1) <> '#'
  and lower(value) not in (
    'compatible',
    'device_type',
    'gpio-controller',
    'interrupt-controller',
    'linux,phandle',
    'phandle',
    'ranges',
    'reg',
    'status',
    '#address-cells',
    '#gpio-cells',
    '#interrupt-cells',
    '#size-cells'
  );

create table parameter_catalog.catalog_releases (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  release_sequence bigint not null
    constraint catalog_release_sequence_ck
    check (release_sequence between 0 and 9007199254740991),
  release_version text not null unique check (release_version <> '' and btrim(release_version) = release_version),
  release_digest text not null unique check (release_digest <> '' and btrim(release_digest) = release_digest),
  predecessor_release_id text references parameter_catalog.catalog_releases(id)
    on delete restrict deferrable initially deferred,
  compiled_model_digest text not null check (compiled_model_digest <> '' and btrim(compiled_model_digest) = compiled_model_digest),
  toolchain_digest text not null check (toolchain_digest <> '' and btrim(toolchain_digest) = toolchain_digest),
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint catalog_release_sequence_unique
    unique (release_sequence) deferrable initially deferred,
  check (predecessor_release_id is null or predecessor_release_id <> id)
);

create function parameter_catalog.assert_catalog_release_predecessor_acyclic()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  cycle_exists boolean;
begin
  with recursive predecessor_walk(release_id, visited_ids, cycle) as (
    select new.id, array[new.id]::text[], false
    union all
    select
      release.predecessor_release_id,
      walk.visited_ids || release.predecessor_release_id,
      release.predecessor_release_id = any(walk.visited_ids)
    from predecessor_walk walk
    join parameter_catalog.catalog_releases release on release.id = walk.release_id
    where release.predecessor_release_id is not null
      and not walk.cycle
  )
  select exists (select 1 from predecessor_walk where cycle)
  into cycle_exists;

  if cycle_exists then
    raise exception using
      errcode = '23514',
      message = 'Catalog release predecessor graph must be acyclic',
      constraint = 'catalog_release_predecessor_acyclic_ck';
  end if;

  return null;
end;
$$;

create constraint trigger catalog_release_predecessor_acyclic_ck
after insert or update of predecessor_release_id on parameter_catalog.catalog_releases
deferrable initially deferred
for each row execute function parameter_catalog.assert_catalog_release_predecessor_acyclic();

create function parameter_catalog.assert_catalog_release_predecessor_sequence()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  predecessor_sequence bigint;
begin
  if new.predecessor_release_id is null then
    return null;
  end if;

  select release_sequence into predecessor_sequence
  from parameter_catalog.catalog_releases
  where id = new.predecessor_release_id;

  if not found or new.release_sequence <> predecessor_sequence + 1 then
    raise exception using
      errcode = '23514',
      message = 'Catalog release sequence must be exactly one greater than its predecessor',
      constraint = 'catalog_release_predecessor_sequence_ck';
  end if;

  return null;
end;
$$;

create constraint trigger catalog_release_predecessor_sequence_ck
after insert or update of predecessor_release_id, release_sequence
on parameter_catalog.catalog_releases
deferrable initially deferred
for each row execute function parameter_catalog.assert_catalog_release_predecessor_sequence();

create function parameter_catalog.assert_catalog_release_predecessor_materialized()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  -- This commit-time guard intentionally accepts a complete predecessor that
  -- was staged earlier in the same transaction.  The predecessor's own
  -- deferred projection-completeness trigger validates its final state.
  if new.predecessor_release_id is not null
     and not exists (
       select 1
       from parameter_catalog.catalog_materializations materialization
       where materialization.release_id = new.predecessor_release_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'Catalog release predecessor must already be materialized and complete',
      constraint = 'catalog_release_predecessor_materialized_ck';
  end if;

  return null;
end;
$$;

create constraint trigger catalog_release_predecessor_materialized_ck
after insert or update of predecessor_release_id on parameter_catalog.catalog_releases
deferrable initially deferred
for each row execute function parameter_catalog.assert_catalog_release_predecessor_materialized();

create table parameter_catalog.catalog_subjects (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  introduced_release_id text not null,
  kind text not null check (kind in ('driver', 'node-type')),
  canonical_key text not null,
  unique (kind, canonical_key),
  unique (id, kind),
  constraint catalog_subject_canonical_key_ck check (
    (kind = 'driver' and parameter_catalog.is_canonical_compatible_selector(canonical_key)) or
    (kind = 'node-type' and parameter_catalog.is_canonical_node_type_name(canonical_key))
  )
);

create table parameter_catalog.catalog_drivers (
  subject_id text primary key,
  nature text not null constraint catalog_driver_nature_ck
    check (nature in ('physical-device', 'logical-service')),
  cardinality text not null constraint catalog_driver_cardinality_ck
    check (cardinality in ('multiple', 'singleton-per-project')),
  foreign key (subject_id) references parameter_catalog.catalog_subjects(id)
    on delete restrict deferrable initially deferred
);

create table parameter_catalog.catalog_node_types (
  subject_id text primary key,
  foreign key (subject_id) references parameter_catalog.catalog_subjects(id)
    on delete restrict deferrable initially deferred
);

create table parameter_catalog.catalog_release_subjects (
  release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  subject_id text not null,
  lifecycle text not null check (lifecycle in ('active', 'retired')),
  selector_snapshot jsonb not null check (jsonb_typeof(selector_snapshot) = 'object'),
  selector_provenance jsonb not null check (jsonb_typeof(selector_provenance) = 'object'),
  tombstone_provenance jsonb,
  primary key (release_id, subject_id),
  constraint catalog_release_subject_subject_fk
    foreign key (subject_id) references parameter_catalog.catalog_subjects(id)
    on delete restrict deferrable initially deferred,
  check (
    (lifecycle = 'active' and tombstone_provenance is null) or
    (lifecycle = 'retired' and jsonb_typeof(tombstone_provenance) = 'object')
  )
);

alter table parameter_catalog.catalog_subjects
  add constraint catalog_subject_introduced_release_fk
  foreign key (introduced_release_id, id)
  references parameter_catalog.catalog_release_subjects(release_id, subject_id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.catalog_subject_aliases (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  introduced_release_id text not null,
  subject_id text not null,
  selector_kind text not null check (selector_kind in ('driver-compatible', 'node-type-name')),
  normalized_selector text not null,
  unique (selector_kind, normalized_selector),
  unique (id, subject_id),
  foreign key (subject_id) references parameter_catalog.catalog_subjects(id)
    on delete restrict deferrable initially deferred,
  constraint catalog_subject_alias_selector_ck check (
    (selector_kind = 'driver-compatible' and parameter_catalog.is_canonical_compatible_selector(normalized_selector)) or
    (selector_kind = 'node-type-name' and parameter_catalog.is_canonical_node_type_name(normalized_selector))
  )
);

create function parameter_catalog.reject_cross_root_selector_collision()
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

revoke all on function parameter_catalog.reject_cross_root_selector_collision() from public;

create trigger catalog_subject_selector_cross_root_unique
before insert on parameter_catalog.catalog_subjects
for each row execute function parameter_catalog.reject_cross_root_selector_collision();

create trigger catalog_subject_alias_selector_cross_root_unique
before insert on parameter_catalog.catalog_subject_aliases
for each row execute function parameter_catalog.reject_cross_root_selector_collision();

create table parameter_catalog.catalog_release_subject_aliases (
  release_id text not null,
  subject_id text not null,
  alias_id text not null,
  lifecycle text not null check (lifecycle in ('active', 'retired')),
  selector_provenance jsonb not null check (jsonb_typeof(selector_provenance) = 'object'),
  tombstone_provenance jsonb,
  primary key (release_id, alias_id),
  foreign key (release_id, subject_id)
    references parameter_catalog.catalog_release_subjects(release_id, subject_id)
    on delete restrict
    deferrable initially deferred,
  foreign key (alias_id, subject_id)
    references parameter_catalog.catalog_subject_aliases(id, subject_id)
    on delete restrict
    deferrable initially deferred,
  check (
    (lifecycle = 'active' and tombstone_provenance is null) or
    (lifecycle = 'retired' and jsonb_typeof(tombstone_provenance) = 'object')
  )
);

alter table parameter_catalog.catalog_subject_aliases
  add constraint catalog_subject_alias_introduced_release_fk
  foreign key (introduced_release_id, id)
  references parameter_catalog.catalog_release_subject_aliases(release_id, alias_id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.parameter_definitions (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  introduced_release_id text not null,
  subject_id text not null,
  property_key text not null constraint parameter_definition_property_key_ck
    check (parameter_catalog.is_canonical_property_key(property_key)),
  current_revision_id text not null,
  unique (subject_id, property_key),
  unique (id, subject_id),
  foreign key (subject_id) references parameter_catalog.catalog_subjects(id)
    on delete restrict deferrable initially deferred
);

create table parameter_catalog.definition_revisions (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  definition_id text not null,
  revision_number bigint not null check (revision_number > 0),
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  content_digest text not null check (content_digest <> '' and btrim(content_digest) = content_digest),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  unique (definition_id, revision_number),
  constraint definition_revision_release_unique
    unique (definition_id, catalog_release_id)
    deferrable initially deferred,
  unique (definition_id, id),
  foreign key (definition_id) references parameter_catalog.parameter_definitions(id)
    on delete restrict deferrable initially deferred
);

alter table parameter_catalog.parameter_definitions
  add constraint parameter_definition_current_revision_fk
  foreign key (id, current_revision_id)
  references parameter_catalog.definition_revisions(definition_id, id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.catalog_release_definition_heads (
  release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  definition_id text not null,
  revision_id text not null,
  primary key (release_id, definition_id),
  constraint catalog_release_definition_head_revision_unique
    unique (release_id, definition_id, revision_id),
  foreign key (definition_id)
    references parameter_catalog.parameter_definitions(id)
    on delete restrict
    deferrable initially deferred,
  foreign key (definition_id, revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict
    deferrable initially deferred
);

alter table parameter_catalog.parameter_definitions
  add constraint parameter_definition_introduced_release_fk
  foreign key (introduced_release_id, id)
  references parameter_catalog.catalog_release_definition_heads(release_id, definition_id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.catalog_materializations (
  release_id text primary key references parameter_catalog.catalog_releases(id) on delete restrict,
  materializing_transaction_id xid8 not null,
  compiled_fingerprint text not null check (compiled_fingerprint <> '' and btrim(compiled_fingerprint) = compiled_fingerprint),
  database_fingerprint text not null check (database_fingerprint <> '' and btrim(database_fingerprint) = database_fingerprint),
  attempt_id text not null check (attempt_id <> '' and btrim(attempt_id) = attempt_id),
  success_audit_ref text not null check (success_audit_ref <> '' and btrim(success_audit_ref) = success_audit_ref),
  installed_at timestamptz not null default now()
);

create function parameter_catalog.lock_catalog_release_for_materialization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  -- Record the top-level writer transaction, not the tuple xmin. PostgreSQL
  -- gives tuples written inside savepoints a subtransaction xmin, while this
  -- value remains the owning top-level transaction ID.
  new.materializing_transaction_id := pg_catalog.pg_current_xact_id();

  perform 1
  from parameter_catalog.catalog_releases
  where id = new.release_id
  for update;

  return new;
end;
$$;

revoke all on function parameter_catalog.lock_catalog_release_for_materialization() from public;

create trigger catalog_materialization_release_lock
before insert on parameter_catalog.catalog_materializations
for each row execute function parameter_catalog.lock_catalog_release_for_materialization();

create function parameter_catalog.assert_catalog_materialization_projection_complete()
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
        (alias.selector_kind = 'node-type-name' and subject.kind <> 'node-type')
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

create constraint trigger catalog_materialization_projection_complete_ck
after insert on parameter_catalog.catalog_materializations
deferrable initially deferred
for each row execute function parameter_catalog.assert_catalog_materialization_projection_complete();

create function parameter_catalog.reject_sealed_catalog_release_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  changed_release_id text;
begin
  changed_release_id := pg_catalog.to_jsonb(new) ->> tg_argv[0];

  perform 1
  from parameter_catalog.catalog_releases
  where id = changed_release_id
  for update;

  if exists (
    select 1
    from parameter_catalog.catalog_materializations
    where release_id = changed_release_id
      and materializing_transaction_id <> pg_catalog.pg_current_xact_id()
  ) then
    raise exception using
      errcode = '55000',
      message = 'Materialized Catalog release semantics are sealed',
      constraint = 'catalog_release_sealed_ck';
  end if;

  return new;
end;
$$;

revoke all on function parameter_catalog.reject_sealed_catalog_release_change() from public;

create trigger catalog_release_subject_sealed
before insert on parameter_catalog.catalog_release_subjects
for each row execute function parameter_catalog.reject_sealed_catalog_release_change('release_id');

create trigger catalog_release_subject_alias_sealed
before insert on parameter_catalog.catalog_release_subject_aliases
for each row execute function parameter_catalog.reject_sealed_catalog_release_change('release_id');

create trigger definition_revision_release_sealed
before insert on parameter_catalog.definition_revisions
for each row execute function parameter_catalog.reject_sealed_catalog_release_change('catalog_release_id');

create trigger catalog_release_definition_head_sealed
before insert on parameter_catalog.catalog_release_definition_heads
for each row execute function parameter_catalog.reject_sealed_catalog_release_change('release_id');

create table parameter_catalog.catalog_state (
  singleton boolean primary key default true check (singleton),
  current_catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict
);

create function parameter_catalog.assert_subject_has_exact_subtype()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  checked_subject_id text;
  subject_kind text;
  driver_count integer;
  node_type_count integer;
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

  if (subject_kind = 'driver' and (driver_count <> 1 or node_type_count <> 0))
     or (subject_kind = 'node-type' and (driver_count <> 0 or node_type_count <> 1)) then
    raise exception using
      errcode = '23514',
      message = 'Catalog subject must have exactly one matching subtype',
      constraint = 'catalog_subject_exact_subtype_ck';
  end if;

  return null;
end;
$$;

create constraint trigger catalog_subject_exact_subtype_from_subject_ck
after insert or update of id, kind on parameter_catalog.catalog_subjects
deferrable initially deferred
for each row execute function parameter_catalog.assert_subject_has_exact_subtype();

create constraint trigger catalog_subject_exact_subtype_from_driver_ck
after insert or update or delete on parameter_catalog.catalog_drivers
deferrable initially deferred
for each row execute function parameter_catalog.assert_subject_has_exact_subtype();

create constraint trigger catalog_subject_exact_subtype_from_node_type_ck
after insert or update or delete on parameter_catalog.catalog_node_types
deferrable initially deferred
for each row execute function parameter_catalog.assert_subject_has_exact_subtype();

create function parameter_catalog.assert_current_release_complete()
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
        (alias.selector_kind = 'node-type-name' and subject.kind <> 'node-type')
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

create function parameter_catalog.lock_catalog_state_pointer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  return new;
end;
$$;

create trigger catalog_state_pointer_lock
before insert or update of current_catalog_release_id on parameter_catalog.catalog_state
for each row execute function parameter_catalog.lock_catalog_state_pointer();

revoke all on function parameter_catalog.lock_catalog_state_pointer() from public;

create constraint trigger catalog_state_current_release_complete_ck
after insert or update of current_catalog_release_id on parameter_catalog.catalog_state
deferrable initially deferred
for each row execute function parameter_catalog.assert_current_release_complete();

create function parameter_catalog.assert_current_definition_head()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  recorded_head_id text;
begin
  select release_head.revision_id into recorded_head_id
  from parameter_catalog.catalog_state state
  join parameter_catalog.catalog_release_definition_heads release_head
    on release_head.release_id = state.current_catalog_release_id
  where state.singleton
    and release_head.definition_id = new.id;

  if found and recorded_head_id is distinct from new.current_revision_id then
    raise exception using
      errcode = '23514',
      message = 'Definition head disagrees with the current Catalog release',
      constraint = 'catalog_current_definition_head_ck';
  end if;

  return null;
end;
$$;

create constraint trigger catalog_current_definition_head_ck
after insert or update of current_revision_id on parameter_catalog.parameter_definitions
deferrable initially deferred
for each row execute function parameter_catalog.assert_current_definition_head();

create function parameter_catalog.protect_parameter_definition_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Parameter definitions cannot be deleted';
  end if;

  if new.id is distinct from old.id
     or new.introduced_release_id is distinct from old.introduced_release_id
     or new.subject_id is distinct from old.subject_id
     or new.property_key is distinct from old.property_key then
    raise exception using errcode = '55000', message = 'Parameter definition identity is immutable';
  end if;

  return new;
end;
$$;

create trigger parameter_definition_identity_immutable
before update or delete on parameter_catalog.parameter_definitions
for each row execute function parameter_catalog.protect_parameter_definition_identity();

create function parameter_catalog.protect_catalog_state_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' or new.singleton is distinct from old.singleton then
    raise exception using errcode = '55000', message = 'Catalog state singleton identity is immutable';
  end if;
  return new;
end;
$$;

create trigger catalog_state_identity_immutable
before update or delete on parameter_catalog.catalog_state
for each row execute function parameter_catalog.protect_catalog_state_identity();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'catalog_releases',
    'catalog_subjects',
    'catalog_drivers',
    'catalog_node_types',
    'catalog_release_subjects',
    'catalog_subject_aliases',
    'catalog_release_subject_aliases',
    'definition_revisions',
    'catalog_release_definition_heads',
    'catalog_materializations'
  ] loop
    execute format(
      'create trigger %I before update or delete on parameter_catalog.%I for each row execute function parameter_catalog.reject_immutable_catalog_change()',
      relation_name || '_immutable',
      relation_name
    );
  end loop;
end;
$$;

-- Redundant composite candidate keys let the canonical schema prove tenant
-- ownership while preserving the legacy tables' existing primary keys.
alter table public.projects
  add constraint projects_id_organization_unique unique (id, organization_id);

alter table public.parameter_modules
  add constraint parameter_modules_id_organization_unique unique (id, organization_id);

-- Canonical Binding and immutable ProjectValue history.
create table parameter_catalog.project_parameter_bindings (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  project_id text not null,
  logical_node_id text not null check (logical_node_id <> '' and btrim(logical_node_id) = logical_node_id),
  registration_id text not null,
  subject_id text not null,
  definition_id text not null,
  effective_revision_id text not null,
  current_value_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, logical_node_id, definition_id),
  unique (id, organization_id),
  unique (id, definition_id),
  unique (id, organization_id, definition_id),
  unique (id, organization_id, project_id, logical_node_id, definition_id),
  constraint project_parameter_binding_match_identity_unique
    unique (
      id, organization_id, project_id, logical_node_id,
      registration_id, subject_id, definition_id
    ),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete restrict,
  foreign key (definition_id, subject_id)
    references parameter_catalog.parameter_definitions(id, subject_id)
    on delete restrict,
  foreign key (definition_id, effective_revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict,
  constraint project_parameter_binding_release_revision_fk
    foreign key (catalog_release_id, definition_id, effective_revision_id)
    references parameter_catalog.catalog_release_definition_heads(
      release_id, definition_id, revision_id
    )
    on delete restrict
    deferrable initially deferred
);

create function parameter_catalog.assert_binding_effective_revision_is_verified_head()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if not exists (
    select 1
    from parameter_catalog.catalog_release_definition_heads release_head
    join parameter_catalog.catalog_materializations materialization
      on materialization.release_id = release_head.release_id
    where release_head.release_id = new.catalog_release_id
      and release_head.definition_id = new.definition_id
      and release_head.revision_id = new.effective_revision_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Binding effective revision must be a head of a verified Catalog release',
      constraint = 'project_parameter_binding_effective_revision_head_fk';
  end if;

  return null;
end;
$$;

create constraint trigger project_parameter_binding_effective_revision_head_fk
after insert or update of catalog_release_id, definition_id, effective_revision_id
on parameter_catalog.project_parameter_bindings
deferrable initially deferred
for each row execute function parameter_catalog.assert_binding_effective_revision_is_verified_head();

create table parameter_catalog.project_parameter_values (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  binding_id text not null,
  definition_id text not null,
  definition_revision_id text not null,
  source_ref text not null check (source_ref <> '' and btrim(source_ref) = source_ref),
  config_revision_id text not null check (config_revision_id <> '' and btrim(config_revision_id) = config_revision_id),
  value_digest text not null check (value_digest <> '' and btrim(value_digest) = value_digest),
  value_kind text not null check (value_kind in ('string', 'number', 'boolean', 'string-array', 'number-array', 'json')),
  value jsonb not null,
  created_at timestamptz not null default now(),
  unique (binding_id, id),
  unique (binding_id, definition_id, id),
  foreign key (binding_id, definition_id)
    references parameter_catalog.project_parameter_bindings(id, definition_id)
    on delete restrict,
  foreign key (definition_id, definition_revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict
);

alter table parameter_catalog.project_parameter_bindings
  add constraint project_parameter_binding_current_value_fk
  foreign key (id, definition_id, current_value_id)
  references parameter_catalog.project_parameter_values(binding_id, definition_id, id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.binding_history_events (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  binding_id text not null references parameter_catalog.project_parameter_bindings(id) on delete restrict,
  old_effective_revision_id text references parameter_catalog.definition_revisions(id) on delete restrict,
  new_effective_revision_id text references parameter_catalog.definition_revisions(id) on delete restrict,
  old_current_value_id text references parameter_catalog.project_parameter_values(id) on delete restrict,
  new_current_value_id text references parameter_catalog.project_parameter_values(id) on delete restrict,
  reason text not null check (reason <> '' and btrim(reason) = reason),
  success_audit_ref text not null check (success_audit_ref <> '' and btrim(success_audit_ref) = success_audit_ref),
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  legacy_mapping_version_id text,
  created_at timestamptz not null default now(),
  check (old_effective_revision_id is distinct from new_effective_revision_id or old_current_value_id is distinct from new_current_value_id)
);

create function parameter_catalog.assert_binding_history_event_owners()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  binding_definition_id text;
begin
  select definition_id into binding_definition_id
  from parameter_catalog.project_parameter_bindings
  where id = new.binding_id;

  if binding_definition_id is null
     or (new.old_effective_revision_id is not null and not exists (
       select 1 from parameter_catalog.definition_revisions
       where id = new.old_effective_revision_id
         and definition_id = binding_definition_id
     ))
     or (new.new_effective_revision_id is not null and not exists (
       select 1 from parameter_catalog.definition_revisions
       where id = new.new_effective_revision_id
         and definition_id = binding_definition_id
     ))
     or (new.old_current_value_id is not null and not exists (
       select 1 from parameter_catalog.project_parameter_values
       where id = new.old_current_value_id
         and binding_id = new.binding_id
         and definition_id = binding_definition_id
     ))
     or (new.new_current_value_id is not null and not exists (
       select 1 from parameter_catalog.project_parameter_values
       where id = new.new_current_value_id
         and binding_id = new.binding_id
         and definition_id = binding_definition_id
     )) then
    raise exception using
      errcode = '23503',
      message = 'Binding history pointers must belong to the same Binding and Definition',
      constraint = 'binding_history_event_owner_fk';
  end if;

  return null;
end;
$$;

create constraint trigger binding_history_event_owner_fk
after insert or update of binding_id, old_effective_revision_id, new_effective_revision_id, old_current_value_id, new_current_value_id
on parameter_catalog.binding_history_events
deferrable initially deferred
for each row execute function parameter_catalog.assert_binding_history_event_owners();

create function parameter_catalog.protect_binding_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Project parameter bindings cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.logical_node_id is distinct from old.logical_node_id
     or new.registration_id is distinct from old.registration_id
     or new.subject_id is distinct from old.subject_id
     or new.definition_id is distinct from old.definition_id then
    raise exception using errcode = '55000', message = 'Project parameter binding identity is immutable';
  end if;
  return new;
end;
$$;

create trigger project_parameter_binding_identity_immutable
before update or delete on parameter_catalog.project_parameter_bindings
for each row execute function parameter_catalog.protect_binding_identity();

create trigger project_parameter_values_immutable
before update or delete on parameter_catalog.project_parameter_values
for each row execute function parameter_catalog.reject_immutable_catalog_change();

create trigger binding_history_events_immutable
before update or delete on parameter_catalog.binding_history_events
for each row execute function parameter_catalog.reject_immutable_catalog_change();

-- Typed legacy identity, Archive, and cutover persistence.  These relations are
-- storage contracts only; phase orchestration belongs to S7 and is intentionally
-- absent from this migration.
create function parameter_catalog.legacy_identity_source_registry()
returns table (
  source_kind text,
  mapping_class text,
  source_relation text,
  primary_key_fields text[],
  owner_extractor text,
  archive_only boolean
)
language sql
immutable
set search_path = pg_catalog, parameter_catalog
as $registry$
select registry.*
from (values
  ('parameter-spec', 'formal-definition', 'public.parameter_specs', array['id']::text[], 'parameter-spec-owner', false),
  ('parameter-spec-version', 'formal-definition', 'public.parameter_spec_versions', array['id']::text[], 'parameter-spec-parent-owner', false),
  ('driver-schema', 'formal-definition', 'public.driver_schemas', array['id']::text[], 'driver-schema-owner', false),
  ('driver-schema-version', 'formal-definition', 'public.driver_schema_versions', array['id']::text[], 'driver-schema-parent-owner', false),
  ('dts-property-spec', 'formal-definition', 'public.dts_property_specs', array['id']::text[], 'property-spec-schema-owner', false),
  ('parameter-subject', 'formal-subject', 'public.attribution_subjects', array['id']::text[], 'subject-owner', false),
  ('parameter-module', 'module-placement', 'public.parameter_modules', array['id']::text[], 'module-organization-owner', false),
  ('parameter-placement', 'module-placement', 'public.driver_registration_placements', array['id']::text[], 'placement-organization-owner', false),
  ('parameter-module-mapping', 'module-placement', 'public.parameter_module_mappings', array['id']::text[], 'module-mapping-parent-owner', false),
  ('parameter-module-dismissed-compatible', 'module-placement', 'public.parameter_module_dismissed_compatibles', array['id']::text[], 'dismissed-compatible-organization-owner', false),
  ('driver-schema-overlay', 'overlay-publication', 'public.driver_schema_overlays', array['id']::text[], 'overlay-organization-owner', false),
  ('driver-schema-overlay-property', 'overlay-publication', 'public.driver_schema_overlay_properties', array['id']::text[], 'overlay-property-parent-owner', false),
  ('driver-schema-overlay-promotion', 'overlay-publication', 'public.driver_schema_overlay_promotions', array['id']::text[], 'overlay-promotion-source-owner', false),
  ('dts-config-revision', 'observation-match', 'public.dts_config_revisions', array['id']::text[], 'config-project-owner', false),
  ('dts-logical-node', 'observation-match', 'public.dts_logical_nodes', array['id']::text[], 'logical-node-project-owner', false),
  ('dts-logical-node-revision', 'observation-match', 'public.dts_logical_node_revisions', array['id']::text[], 'logical-node-revision-lineage-owner', false),
  ('dts-node-occurrence', 'observation-match', 'public.dts_node_occurrences', array['id']::text[], 'occurrence-config-owner', false),
  ('dts-property-occurrence', 'observation-match', 'public.dts_property_occurrences', array['id']::text[], 'occurrence-config-owner', false),
  ('dts-occurrence-effect', 'observation-match', 'public.dts_occurrence_effects', array['id']::text[], 'effect-lineage-owner', false),
  ('dts-property-occurrence-spec-decision', 'observation-match', 'public.dts_property_occurrence_spec_decisions', array['id']::text[], 'decision-project-owner', false),
  ('project-parameter-binding', 'binding-value', 'public.project_parameter_bindings', array['id']::text[], 'binding-project-owner', false),
  ('project-parameter-binding-revision', 'binding-value', 'public.project_parameter_binding_revisions', array['id']::text[], 'binding-revision-parent-owner', false),
  ('legacy-flat-parameter-definition', 'legacy-semantic-store', 'public.parameter_definitions', array['id']::text[], 'flat-definition-organization-owner', false),
  ('legacy-flat-project-parameter-value', 'legacy-semantic-store', 'public.project_parameter_values', array['id']::text[], 'flat-value-project-owner', false),
  ('parameter-draft', 'draft-review', 'public.parameter_drafts', array['id']::text[], 'workflow-project-owner', false),
  ('parameter-submission-round', 'draft-review', 'public.parameter_submission_rounds', array['id']::text[], 'workflow-project-owner', false),
  ('parameter-submission-item', 'draft-review', 'public.parameter_submission_items', array['id']::text[], 'submission-item-parent-owner', false),
  ('parameter-change-request', 'draft-review', 'public.parameter_change_requests', array['id']::text[], 'workflow-project-owner', false),
  ('parameter-review-decision', 'draft-review', 'public.parameter_review_decisions', array['id']::text[], 'review-decision-request-owner', false),
  ('parameter-spec-review-task', 'draft-review', 'public.parameter_spec_review_tasks', array['id']::text[], 'review-task-project-or-organization-owner', false),
  ('parameter-spec-matcher-override', 'draft-review', 'public.parameter_spec_matcher_overrides', array['id']::text[], 'workflow-project-owner', false),
  ('parameter-file-sync-conflict', 'file-import-initialization', 'public.parameter_file_sync_conflicts', array['id']::text[], 'workflow-project-owner', false),
  ('parameter-import-batch', 'file-import-initialization', 'public.parameter_import_batches', array['id']::text[], 'workflow-project-owner', false),
  ('project-parameter-initialization-draft', 'file-import-initialization', 'public.project_parameter_initialization_drafts', array['id']::text[], 'workflow-project-owner', false),
  ('project-parameter-initialization-review', 'file-import-initialization', 'public.project_parameter_initialization_reviews', array['id']::text[], 'initialization-review-project-owner', false),
  ('parameter-definition-reconciliation-run', 'migration-history', 'public.parameter_definition_reconciliation_runs', array['id']::text[], 'reconciliation-organization-owner', false),
  ('parameter-definition-reconciliation-item', 'migration-history', 'public.parameter_definition_reconciliation_items', array['id']::text[], 'reconciliation-item-parent-owner', false),
  ('parameter-spec-version-cutover-run', 'migration-history', 'public.parameter_spec_version_cutover_runs', array['id']::text[], 'cutover-run-organization-owner', false),
  ('parameter-spec-version-cutover-item', 'migration-history', 'public.parameter_spec_version_cutover_items', array['id']::text[], 'cutover-item-project-owner', false),
  ('parameter-spec-property-key-cutover-run', 'migration-history', 'public.parameter_spec_property_key_cutover_runs', array['id']::text[], 'cutover-run-organization-owner', false),
  ('parameter-spec-property-key-cutover-item', 'migration-history', 'public.parameter_spec_property_key_cutover_items', array['id']::text[], 'cutover-item-project-owner', false),
  ('parameter-identity-migration-run', 'migration-history', 'public.parameter_identity_migration_runs', array['id']::text[], 'platform-migration-owner', false),
  ('parameter-identity-migration-phase', 'migration-history', 'public.parameter_identity_migration_phases', array['id']::text[], 'migration-phase-parent-owner', false),
  ('parameter-identity-cutover', 'migration-history', 'public.parameter_identity_cutovers', array['id']::text[], 'migration-cutover-parent-owner', false),
  ('parameter-history-entry', 'migration-history', 'public.parameter_history_entries', array['id']::text[], 'history-project-or-organization-owner', false),
  ('legacy-parameter-migration-evidence', 'migration-history', 'public.legacy_parameter_migration_evidence', array['id']::text[], 'migration-evidence-organization-owner', false),
  ('parameter-policy-target', 'policy-audit-protected', 'public.parameter_policy_targets', array['id']::text[], 'policy-organization-owner', false),
  ('audit-subject-link', 'policy-audit-protected', 'public.audit_subject_links', array['auditEventId', 'subjectKind', 'semanticId']::text[], 'audit-event-project-or-organization', false),
  ('unresolved-protected-reference', 'policy-audit-protected', null::text, array['consumerTable', 'consumerPrimaryKey', 'column', 'rawReferencedId']::text[], 'embedded-protected-reference-owner', true)
) as registry(source_kind, mapping_class, source_relation, primary_key_fields, owner_extractor, archive_only)
$registry$;

revoke all on function parameter_catalog.legacy_identity_source_registry() from public;

create function parameter_catalog.serialize_legacy_source_key(
  ordered_field_names text[],
  ordered_field_values text[]
)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, parameter_catalog
as $$
declare
  field_index integer;
  serialized text := E'{\n';
begin
  if cardinality(ordered_field_names) = 0
     or cardinality(ordered_field_names) is distinct from cardinality(ordered_field_values)
     or exists (
       select 1
       from generate_subscripts(ordered_field_names, 1) field_position
       where ordered_field_names[field_position] is null
          or ordered_field_values[field_position] is null
          or ordered_field_names[field_position] = ''
          or ordered_field_values[field_position] = ''
          or (
            field_position > 1
            and ordered_field_names[field_position - 1] >= ordered_field_names[field_position]
          )
     ) then
    raise exception using
      errcode = '23514',
      message = 'Composite legacy source fields must be non-empty and byte-sorted',
      constraint = 'legacy_identity_composite_source_ck';
  end if;

  for field_index in 1 .. cardinality(ordered_field_names) loop
    if field_index > 1 then
      serialized := serialized || E',\n';
    end if;
    serialized := serialized
      || '  '
      || pg_catalog.to_json(ordered_field_names[field_index])::text
      || ': '
      || pg_catalog.to_json(ordered_field_values[field_index])::text;
  end loop;

  return serialized || E'\n}\n';
end;
$$;

revoke all on function parameter_catalog.serialize_legacy_source_key(text[], text[]) from public;

create function parameter_catalog.resolve_legacy_identity_owner(
  requested_source_kind text,
  requested_source_id text
)
returns table (owner_scope_kind text, owner_scope_id text)
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  source_payload jsonb;
  expected_source_id text;
  consumer_source_kind text;
begin
  case requested_source_kind
    when 'parameter-spec' then
      return query
      select
        case when spec.organization_id is null then 'platform' else 'organization' end,
        coalesce(spec.organization_id, 'platform')
      from public.parameter_specs spec
      where spec.id = requested_source_id;
    when 'parameter-spec-version' then
      return query
      select
        case when spec.organization_id is null then 'platform' else 'organization' end,
        coalesce(spec.organization_id, 'platform')
      from public.parameter_spec_versions version
      join public.parameter_specs spec on spec.id = version.parameter_spec_id
      where version.id = requested_source_id;
    when 'driver-schema' then
      return query
      select
        case when schema_record.organization_id is null then 'platform' else 'organization' end,
        coalesce(schema_record.organization_id, 'platform')
      from public.driver_schemas schema_record
      join public.parameter_specs root on root.id = schema_record.parameter_spec_id
      left join public.attribution_subjects subject
        on subject.id = schema_record.attribution_subject_id
      where schema_record.id = requested_source_id
        and root.organization_id is not distinct from schema_record.organization_id
        and (
          schema_record.attribution_subject_id is null
          or subject.organization_id is not distinct from schema_record.organization_id
        );
    when 'driver-schema-version' then
      return query
      select owner.owner_scope_kind, owner.owner_scope_id
      from public.driver_schema_versions version
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'driver-schema', version.driver_schema_id
      ) owner
      where version.id = requested_source_id;
    when 'dts-property-spec' then
      return query
      select owner.owner_scope_kind, owner.owner_scope_id
      from public.dts_property_specs property
      join public.driver_schemas schema_record on schema_record.id = property.driver_schema_id
      join public.parameter_specs spec on spec.id = property.parameter_spec_id
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'driver-schema', schema_record.id
      ) owner
      where property.id = requested_source_id
        and spec.organization_id is not distinct from schema_record.organization_id
        and spec.attribution_subject_id is not distinct from schema_record.attribution_subject_id;
    when 'parameter-subject' then
      return query
      select
        case when subject.organization_id is null then 'platform' else 'organization' end,
        coalesce(subject.organization_id, 'platform')
      from public.attribution_subjects subject
      where subject.id = requested_source_id;
    when 'parameter-module' then
      return query
      select 'organization', module.organization_id
      from public.parameter_modules module
      where module.id = requested_source_id;
    when 'parameter-placement' then
      return query
      select 'organization', placement.organization_id
      from public.driver_registration_placements placement
      join public.parameter_modules module
        on module.id = placement.driver_group_module_id
       and module.organization_id = placement.organization_id
      join public.attribution_subjects subject
        on subject.id = placement.attribution_subject_id
       and subject.organization_id = placement.organization_id
      where placement.id = requested_source_id;
    when 'parameter-module-mapping' then
      return query
      select 'organization', mapping.organization_id
      from public.parameter_module_mappings mapping
      join public.parameter_modules module
        on module.id = mapping.parameter_module_id
       and module.organization_id = mapping.organization_id
      where mapping.id = requested_source_id;
    when 'parameter-module-dismissed-compatible' then
      return query
      select 'organization', dismissed.organization_id
      from public.parameter_module_dismissed_compatibles dismissed
      where dismissed.id = requested_source_id;
    when 'driver-schema-overlay' then
      return query
      select
        case when overlay.organization_id is null then 'platform' else 'organization' end,
        coalesce(overlay.organization_id, 'platform')
      from public.driver_schema_overlays overlay
      where overlay.id = requested_source_id;
    when 'driver-schema-overlay-property' then
      return query
      select owner.owner_scope_kind, owner.owner_scope_id
      from public.driver_schema_overlay_properties property
      join public.driver_schema_overlays overlay on overlay.id = property.driver_schema_overlay_id
      join public.parameter_specs spec on spec.id = property.parameter_spec_id
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'driver-schema-overlay', overlay.id
      ) owner
      where property.id = requested_source_id
        and spec.organization_id is not distinct from overlay.organization_id;
    when 'driver-schema-overlay-promotion' then
      return query
      select 'organization', promotion.source_organization_id
      from public.driver_schema_overlay_promotions promotion
      join public.driver_schema_overlays source_overlay
        on source_overlay.id = promotion.source_schema_id
       and source_overlay.organization_id = promotion.source_organization_id
      join public.driver_schema_overlays platform_overlay
        on platform_overlay.id = promotion.platform_schema_id
       and platform_overlay.organization_id is null
      where promotion.id = requested_source_id;
    when 'dts-config-revision' then
      return query
      select 'project', revision.project_id
      from public.dts_config_revisions revision
      join public.projects project
        on project.id = revision.project_id
       and project.organization_id = revision.organization_id
      join public.dts_config_set config_set
        on config_set.id = revision.config_set_id
       and config_set.project_id = revision.project_id
       and config_set.organization_id = revision.organization_id
      where revision.id = requested_source_id;
    when 'dts-logical-node' then
      return query
      select 'project', node.project_id
      from public.dts_logical_nodes node
      join public.projects project
        on project.id = node.project_id
       and project.organization_id = node.organization_id
      join public.dts_config_set config_set
        on config_set.id = node.config_set_id
       and config_set.project_id = node.project_id
       and config_set.organization_id = node.organization_id
      where node.id = requested_source_id;
    when 'dts-logical-node-revision' then
      return query
      select 'project', node.project_id
      from public.dts_logical_node_revisions revision
      join public.dts_logical_nodes node on node.id = revision.logical_node_id
      join public.dts_config_revisions config_revision
        on config_revision.id = revision.config_revision_id
       and config_revision.project_id = node.project_id
       and config_revision.organization_id = node.organization_id
       and config_revision.config_set_id = node.config_set_id
      where revision.id = requested_source_id;
    when 'dts-node-occurrence' then
      return query
      select owner.owner_scope_kind, owner.owner_scope_id
      from public.dts_node_occurrences occurrence
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-config-revision', occurrence.config_revision_id
      ) owner
      where occurrence.id = requested_source_id;
    when 'dts-property-occurrence' then
      return query
      select owner.owner_scope_kind, owner.owner_scope_id
      from public.dts_property_occurrences occurrence
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-config-revision', occurrence.config_revision_id
      ) owner
      where occurrence.id = requested_source_id;
    when 'dts-occurrence-effect' then
      return query
      select config_owner.owner_scope_kind, config_owner.owner_scope_id
      from public.dts_occurrence_effects effect
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-config-revision', effect.config_revision_id
      ) config_owner
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-logical-node-revision', effect.logical_node_revision_id
      ) logical_owner
      where effect.id = requested_source_id
        and config_owner.owner_scope_kind = logical_owner.owner_scope_kind
        and config_owner.owner_scope_id = logical_owner.owner_scope_id;
    when 'dts-property-occurrence-spec-decision' then
      return query
      select 'project', decision.project_id
      from public.dts_property_occurrence_spec_decisions decision
      join public.projects project
        on project.id = decision.project_id
       and project.organization_id = decision.organization_id
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-config-revision', decision.config_revision_id
      ) config_owner
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-logical-node', decision.logical_node_id
      ) logical_owner
      where decision.id = requested_source_id
        and config_owner.owner_scope_kind = 'project'
        and config_owner.owner_scope_id = decision.project_id
        and logical_owner.owner_scope_kind = 'project'
        and logical_owner.owner_scope_id = decision.project_id;
    when 'project-parameter-binding' then
      return query
      select 'project', binding.project_id
      from public.project_parameter_bindings binding
      join public.projects project
        on project.id = binding.project_id
       and project.organization_id = binding.organization_id
      where binding.id = requested_source_id;
    when 'project-parameter-binding-revision' then
      return query
      select binding_owner.owner_scope_kind, binding_owner.owner_scope_id
      from public.project_parameter_binding_revisions revision
      join public.project_parameter_bindings binding on binding.id = revision.binding_id
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'project-parameter-binding', binding.id
      ) binding_owner
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'dts-config-revision', revision.config_revision_id
      ) config_owner
      where revision.id = requested_source_id
        and binding_owner.owner_scope_kind = config_owner.owner_scope_kind
        and binding_owner.owner_scope_id = config_owner.owner_scope_id;
    when 'legacy-flat-parameter-definition' then
      return query
      select 'organization', definition.organization_id
      from public.parameter_definitions definition
      where definition.id = requested_source_id;
    when 'legacy-flat-project-parameter-value' then
      return query
      select 'project', value.project_id
      from public.project_parameter_values value
      join public.projects project
        on project.id = value.project_id
       and project.organization_id = value.organization_id
      where value.id = requested_source_id;
    when 'parameter-draft' then
      return query
      select 'project', draft.project_id
      from public.parameter_drafts draft
      join public.projects project
        on project.id = draft.project_id
       and project.organization_id = draft.organization_id
      where draft.id = requested_source_id;
    when 'parameter-submission-round' then
      return query
      select 'project', round_record.project_id
      from public.parameter_submission_rounds round_record
      join public.projects project
        on project.id = round_record.project_id
       and project.organization_id = round_record.organization_id
      where round_record.id = requested_source_id;
    when 'parameter-submission-item' then
      return query
      select round_owner.owner_scope_kind, round_owner.owner_scope_id
      from public.parameter_submission_items item
      join public.parameter_submission_rounds round_record
        on round_record.id = item.submission_round_id
       and round_record.organization_id = item.organization_id
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'parameter-submission-round', round_record.id
      ) round_owner
      where item.id = requested_source_id;
    when 'parameter-change-request' then
      return query
      select 'project', request.project_id
      from public.parameter_change_requests request
      join public.projects project
        on project.id = request.project_id
       and project.organization_id = request.organization_id
      where request.id = requested_source_id;
    when 'parameter-review-decision' then
      return query
      select request_owner.owner_scope_kind, request_owner.owner_scope_id
      from public.parameter_review_decisions decision
      join public.parameter_change_requests request
        on request.id = decision.request_id
       and request.organization_id = decision.organization_id
      cross join lateral parameter_catalog.resolve_legacy_identity_owner(
        'parameter-change-request', request.id
      ) request_owner
      where decision.id = requested_source_id;
    when 'parameter-spec-review-task' then
      return query
      select
        case when task.project_id is null then 'organization' else 'project' end,
        coalesce(task.project_id, task.organization_id)
      from public.parameter_spec_review_tasks task
      left join public.projects project on project.id = task.project_id
      where task.id = requested_source_id
        and (
          task.project_id is null
          or project.organization_id = task.organization_id
        );
    when 'parameter-spec-matcher-override' then
      return query
      select 'project', override_record.project_id
      from public.parameter_spec_matcher_overrides override_record
      join public.projects project
        on project.id = override_record.project_id
       and project.organization_id = override_record.organization_id
      where override_record.id = requested_source_id;
    when 'parameter-file-sync-conflict' then
      return query
      select 'project', conflict.project_id
      from public.parameter_file_sync_conflicts conflict
      join public.projects project
        on project.id = conflict.project_id
       and project.organization_id = conflict.organization_id
      where conflict.id = requested_source_id;
    when 'parameter-import-batch' then
      return query
      select 'project', batch.project_id
      from public.parameter_import_batches batch
      join public.projects project
        on project.id = batch.project_id
       and project.organization_id = batch.organization_id
      where batch.id = requested_source_id;
    when 'project-parameter-initialization-draft' then
      return query
      select 'project', draft.project_id
      from public.project_parameter_initialization_drafts draft
      join public.projects project
        on project.id = draft.project_id
       and project.organization_id = draft.organization_id
      where draft.id = requested_source_id;
    when 'project-parameter-initialization-review' then
      return query
      select 'project', review.project_id
      from public.project_parameter_initialization_reviews review
      join public.project_parameter_initialization_drafts draft
        on draft.id = review.draft_id
       and draft.project_id = review.project_id
       and draft.organization_id = review.organization_id
      where review.id = requested_source_id;
    when 'parameter-definition-reconciliation-run' then
      return query
      select 'organization', run.organization_id
      from public.parameter_definition_reconciliation_runs run
      where run.id = requested_source_id;
    when 'parameter-definition-reconciliation-item' then
      return query
      select 'organization', item.organization_id
      from public.parameter_definition_reconciliation_items item
      join public.parameter_definition_reconciliation_runs run
        on run.id = item.run_id
       and run.organization_id = item.organization_id
      where item.id = requested_source_id;
    when 'parameter-spec-version-cutover-run' then
      return query
      select 'organization', run.organization_id
      from public.parameter_spec_version_cutover_runs run
      where run.id = requested_source_id;
    when 'parameter-spec-version-cutover-item' then
      return query
      select 'project', item.project_id
      from public.parameter_spec_version_cutover_items item
      join public.parameter_spec_version_cutover_runs run on run.id = item.run_id
      join public.projects project
        on project.id = item.project_id
       and project.organization_id = run.organization_id
      where item.id = requested_source_id;
    when 'parameter-spec-property-key-cutover-run' then
      return query
      select 'organization', run.organization_id
      from public.parameter_spec_property_key_cutover_runs run
      where run.id = requested_source_id;
    when 'parameter-spec-property-key-cutover-item' then
      return query
      select 'project', item.project_id
      from public.parameter_spec_property_key_cutover_items item
      join public.parameter_spec_property_key_cutover_runs run on run.id = item.run_id
      join public.projects project
        on project.id = item.project_id
       and project.organization_id = run.organization_id
      where item.id = requested_source_id;
    when 'parameter-identity-migration-run' then
      return query
      select 'platform', 'platform'
      from public.parameter_identity_migration_runs run
      where run.id = requested_source_id;
    when 'parameter-identity-migration-phase' then
      return query
      select 'platform', 'platform'
      from public.parameter_identity_migration_phases phase
      join public.parameter_identity_migration_runs run on run.id = phase.migration_run_id
      where phase.id = requested_source_id;
    when 'parameter-identity-cutover' then
      return query
      select 'platform', 'platform'
      from public.parameter_identity_cutovers cutover
      join public.parameter_identity_migration_runs run on run.id = cutover.migration_run_id
      where cutover.id = requested_source_id;
    when 'parameter-history-entry' then
      return query
      select
        case when history.project_id is null then 'organization' else 'project' end,
        coalesce(history.project_id, history.organization_id)
      from public.parameter_history_entries history
      left join public.projects project on project.id = history.project_id
      where history.id = requested_source_id
        and (
          history.project_id is null
          or project.organization_id = history.organization_id
        );
    when 'legacy-parameter-migration-evidence' then
      return query
      select 'organization', evidence.organization_id
      from public.legacy_parameter_migration_evidence evidence
      where evidence.id = requested_source_id;
    when 'parameter-policy-target' then
      return query
      select 'organization', policy.organization_id
      from public.parameter_policy_targets policy
      where policy.id = requested_source_id;
    when 'audit-subject-link' then
      begin
        source_payload := requested_source_id::jsonb;
      exception when others then
        raise exception using
          errcode = '23514',
          message = 'Composite legacy source ID is not valid contract JSON',
          constraint = 'legacy_identity_composite_source_ck';
      end;
      if jsonb_typeof(source_payload) <> 'object'
         or (select count(*) from jsonb_object_keys(source_payload)) <> 3
         or not source_payload ?& array['auditEventId', 'semanticId', 'subjectKind'] then
        raise exception using
          errcode = '23514',
          message = 'Audit subject link source ID must contain its complete composite primary key',
          constraint = 'legacy_identity_composite_source_ck';
      end if;
      expected_source_id := parameter_catalog.serialize_legacy_source_key(
        array['auditEventId', 'semanticId', 'subjectKind'],
        array[
          source_payload ->> 'auditEventId',
          source_payload ->> 'semanticId',
          source_payload ->> 'subjectKind'
        ]
      );
      if requested_source_id <> expected_source_id then
        raise exception using
          errcode = '23514',
          message = 'Composite legacy source ID must use serializeContract bytes',
          constraint = 'legacy_identity_composite_source_ck';
      end if;
      return query
      select
        case when event.project_id is null then 'organization' else 'project' end,
        coalesce(event.project_id, event.organization_id)
      from public.audit_subject_links link
      join public.audit_events event on event.id = link.audit_event_id
      where link.audit_event_id = source_payload ->> 'auditEventId'
        and link.semantic_id = source_payload ->> 'semanticId'
        and link.subject_kind = source_payload ->> 'subjectKind';
    when 'unresolved-protected-reference' then
      begin
        source_payload := requested_source_id::jsonb;
      exception when others then
        raise exception using
          errcode = '23514',
          message = 'Protected reference source ID is not valid contract JSON',
          constraint = 'legacy_identity_composite_source_ck';
      end;
      if jsonb_typeof(source_payload) <> 'object'
         or (select count(*) from jsonb_object_keys(source_payload)) <> 4
         or not source_payload ?& array[
           'column', 'consumerPrimaryKey', 'consumerTable', 'rawReferencedId'
         ] then
        raise exception using
          errcode = '23514',
          message = 'Protected reference source ID must contain the complete consumer locator',
          constraint = 'legacy_identity_composite_source_ck';
      end if;
      expected_source_id := parameter_catalog.serialize_legacy_source_key(
        array['column', 'consumerPrimaryKey', 'consumerTable', 'rawReferencedId'],
        array[
          source_payload ->> 'column',
          source_payload ->> 'consumerPrimaryKey',
          source_payload ->> 'consumerTable',
          source_payload ->> 'rawReferencedId'
        ]
      );
      if requested_source_id <> expected_source_id then
        raise exception using
          errcode = '23514',
          message = 'Protected reference source ID must use serializeContract bytes',
          constraint = 'legacy_identity_composite_source_ck';
      end if;
      select registry.source_kind into consumer_source_kind
      from parameter_catalog.legacy_identity_source_registry() registry
      where registry.source_relation = source_payload ->> 'consumerTable'
        and cardinality(registry.primary_key_fields) = 1
      order by registry.source_kind
      limit 1;
      if consumer_source_kind is null then
        raise exception using
          errcode = '23514',
          message = 'Protected reference consumer relation is outside the fixed source registry',
          constraint = 'legacy_identity_protected_consumer_ck';
      end if;
      return query
      select owner.owner_scope_kind, owner.owner_scope_id
      from parameter_catalog.resolve_legacy_identity_owner(
        consumer_source_kind,
        source_payload ->> 'consumerPrimaryKey'
      ) owner;
    else
      raise exception using
        errcode = '23514',
        message = 'Legacy identity source owner extractor is not registered',
        constraint = 'legacy_identity_source_extractor_ck';
  end case;
end;
$$;

revoke all on function parameter_catalog.resolve_legacy_identity_owner(text, text) from public;

create table parameter_catalog.legacy_identities (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  source_system text not null check (source_system <> '' and btrim(source_system) = source_system),
  source_kind text not null check (source_kind in (
    'parameter-spec',
    'parameter-spec-version',
    'driver-schema',
    'driver-schema-version',
    'dts-property-spec',
    'parameter-subject',
    'parameter-module',
    'parameter-placement',
    'parameter-module-mapping',
    'parameter-module-dismissed-compatible',
    'driver-schema-overlay',
    'driver-schema-overlay-property',
    'driver-schema-overlay-promotion',
    'dts-config-revision',
    'dts-logical-node',
    'dts-logical-node-revision',
    'dts-node-occurrence',
    'dts-property-occurrence',
    'dts-occurrence-effect',
    'dts-property-occurrence-spec-decision',
    'project-parameter-binding',
    'project-parameter-binding-revision',
    'legacy-flat-parameter-definition',
    'legacy-flat-project-parameter-value',
    'parameter-draft',
    'parameter-submission-round',
    'parameter-submission-item',
    'parameter-change-request',
    'parameter-review-decision',
    'parameter-spec-review-task',
    'parameter-spec-matcher-override',
    'parameter-file-sync-conflict',
    'parameter-import-batch',
    'project-parameter-initialization-draft',
    'project-parameter-initialization-review',
    'parameter-definition-reconciliation-run',
    'parameter-definition-reconciliation-item',
    'parameter-spec-version-cutover-run',
    'parameter-spec-version-cutover-item',
    'parameter-spec-property-key-cutover-run',
    'parameter-spec-property-key-cutover-item',
    'parameter-identity-migration-run',
    'parameter-identity-migration-phase',
    'parameter-identity-cutover',
    'parameter-history-entry',
    'legacy-parameter-migration-evidence',
    'parameter-policy-target',
    'audit-subject-link',
    'unresolved-protected-reference'
  )),
  owner_scope_kind text not null check (owner_scope_kind in ('platform', 'organization', 'project')),
  owner_scope_id text not null check (owner_scope_id <> '' and btrim(owner_scope_id) = owner_scope_id),
  constraint legacy_identity_platform_owner_tuple check (
    owner_scope_kind <> 'platform' or owner_scope_id = 'platform'
  ),
  source_id text not null check (source_id <> '' and btrim(source_id) = source_id),
  created_at timestamptz not null default now(),
  unique (source_system, source_kind, owner_scope_kind, owner_scope_id, source_id),
  unique (id, owner_scope_kind, owner_scope_id)
);

create function parameter_catalog.assert_legacy_identity_source_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  derived_owner_scope_kind text;
  derived_owner_scope_id text;
begin
  if new.owner_scope_kind = 'platform' and new.owner_scope_id <> 'platform' then
    raise exception using
      errcode = '23514',
      message = 'Platform legacy identity owner tuple must use the reserved Platform ID',
      constraint = 'legacy_identity_platform_owner_tuple';
  end if;

  select owner.owner_scope_kind, owner.owner_scope_id
  into derived_owner_scope_kind, derived_owner_scope_id
  from parameter_catalog.resolve_legacy_identity_owner(new.source_kind, new.source_id) owner;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Legacy identity source row does not exist or its ownership graph is incomplete',
      constraint = 'legacy_identity_source_fk';
  end if;

  if new.owner_scope_kind is distinct from derived_owner_scope_kind
     or new.owner_scope_id is distinct from derived_owner_scope_id then
    raise exception using
      errcode = '23503',
      message = 'Legacy identity owner differs from the fixed source owner extractor',
      constraint = 'legacy_identity_source_owner_fk';
  end if;

  return new;
end;
$$;

revoke all on function parameter_catalog.assert_legacy_identity_source_owner() from public;

create trigger legacy_identity_source_owner_fk
before insert or update of source_kind, source_id, owner_scope_kind, owner_scope_id
on parameter_catalog.legacy_identities
for each row execute function parameter_catalog.assert_legacy_identity_source_owner();

create table parameter_catalog.parameter_catalog_cutover_runs (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  source_snapshot_fingerprint text not null check (source_snapshot_fingerprint <> '' and btrim(source_snapshot_fingerprint) = source_snapshot_fingerprint),
  target_artifact_sha text not null check (target_artifact_sha ~ '^[0-9a-f]{40}$'),
  target_catalog_release_digest text not null check (target_catalog_release_digest <> '' and btrim(target_catalog_release_digest) = target_catalog_release_digest),
  migration_contract_version text not null check (migration_contract_version <> '' and btrim(migration_contract_version) = migration_contract_version),
  plan_digest text not null check (plan_digest <> '' and btrim(plan_digest) = plan_digest),
  current_phase text not null check (current_phase ~ '^P(?:[0-9]|1[0-6])$'),
  state text not null check (state in ('planned', 'running', 'failed', 'completed', 'recovery-required')),
  pointer_rollback_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    source_snapshot_fingerprint,
    target_artifact_sha,
    target_catalog_release_digest,
    migration_contract_version,
    plan_digest
  )
);

create table parameter_catalog.parameter_catalog_cutover_events (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  sequence_number bigint not null check (sequence_number > 0),
  phase text not null check (phase ~ '^P(?:[0-9]|1[0-6])$'),
  event_kind text not null check (event_kind <> '' and btrim(event_kind) = event_kind),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (cutover_run_id, sequence_number)
);

create table parameter_catalog.parameter_catalog_cutover_checkpoints (
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  phase text not null check (phase ~ '^P(?:[0-9]|1[0-6])$'),
  checkpoint_digest text not null check (checkpoint_digest <> '' and btrim(checkpoint_digest) = checkpoint_digest),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  committed_at timestamptz not null default now(),
  primary key (cutover_run_id, phase)
);

create table parameter_catalog.parameter_catalog_archives (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  legacy_identity_id text not null,
  owner_scope_kind text not null check (owner_scope_kind in ('platform', 'organization', 'project')),
  owner_scope_id text not null check (owner_scope_id <> '' and btrim(owner_scope_id) = owner_scope_id),
  r_class text not null check (r_class ~ '^R(?:[0-9]|10)$'),
  reason text not null check (reason <> '' and btrim(reason) = reason),
  source_checksum text not null check (source_checksum <> '' and btrim(source_checksum) = source_checksum),
  graph_checksum text not null check (graph_checksum <> '' and btrim(graph_checksum) = graph_checksum),
  encrypted_object_ref text not null check (encrypted_object_ref <> '' and btrim(encrypted_object_ref) = encrypted_object_ref),
  protected_references jsonb not null check (jsonb_typeof(protected_references) = 'array'),
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  success_audit_ref text not null check (success_audit_ref <> '' and btrim(success_audit_ref) = success_audit_ref),
  retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, legacy_identity_id, cutover_run_id),
  foreign key (legacy_identity_id, owner_scope_kind, owner_scope_id)
    references parameter_catalog.legacy_identities(id, owner_scope_kind, owner_scope_id)
    on delete restrict
);

create table parameter_catalog.legacy_mapping_versions (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  legacy_identity_id text not null references parameter_catalog.legacy_identities(id) on delete restrict,
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  version_number bigint not null check (version_number > 0),
  source_checksum text not null check (source_checksum <> '' and btrim(source_checksum) = source_checksum),
  graph_fingerprint text not null check (graph_fingerprint <> '' and btrim(graph_fingerprint) = graph_fingerprint),
  r_class text not null check (r_class ~ '^R(?:[0-9]|10)$'),
  target_kind text check (target_kind in (
    'catalog-subject',
    'parameter-definition',
    'definition-revision',
    'subject-registration',
    'subject-placement',
    'parameter-binding',
    'project-value',
    'binding-history-event',
    'parameter-observation',
    'observation-match',
    'review-evidence',
    'review-item',
    'review-resolution',
    'definition-proposal',
    'definition-proposal-revision',
    'publication-intent',
    'policy',
    'audit-event',
    'migration-history'
  )),
  target_id text,
  archive_id text,
  evidence_archive_id text,
  supersedes_version_id text,
  created_at timestamptz not null default now(),
  unique (legacy_identity_id, version_number),
  unique (legacy_identity_id, id),
  unique (id, legacy_identity_id, cutover_run_id),
  check (
    (target_kind is not null and target_id is not null and archive_id is null) or
    (target_kind is null and target_id is null and archive_id is not null)
  ),
  check (target_id is null or (target_id <> '' and btrim(target_id) = target_id)),
  check (evidence_archive_id is null or evidence_archive_id is distinct from archive_id),
  foreign key (archive_id, legacy_identity_id, cutover_run_id)
    references parameter_catalog.parameter_catalog_archives(id, legacy_identity_id, cutover_run_id)
    on delete restrict,
  foreign key (evidence_archive_id, legacy_identity_id, cutover_run_id)
    references parameter_catalog.parameter_catalog_archives(id, legacy_identity_id, cutover_run_id)
    on delete restrict,
  foreign key (supersedes_version_id, legacy_identity_id, cutover_run_id)
    references parameter_catalog.legacy_mapping_versions(id, legacy_identity_id, cutover_run_id)
    on delete restrict
);

create function parameter_catalog.assert_legacy_mapping_target_exists()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  mapping_source_kind text;
  mapping_owner_scope_kind text;
  mapping_owner_scope_id text;
  target_compatible boolean;
  target_exists boolean;
  target_owner_scope_kind text;
  target_owner_scope_id text;
begin
  if new.target_kind is null then
    return null;
  end if;

  select source_kind, owner_scope_kind, owner_scope_id
  into mapping_source_kind, mapping_owner_scope_kind, mapping_owner_scope_id
  from parameter_catalog.legacy_identities
  where id = new.legacy_identity_id;

  target_compatible := case
    when mapping_source_kind in (
      'parameter-spec',
      'parameter-spec-version',
      'driver-schema',
      'driver-schema-version',
      'dts-property-spec'
    ) then new.target_kind in (
      'catalog-subject',
      'parameter-definition',
      'definition-revision',
      'parameter-observation',
      'review-evidence',
      'definition-proposal',
      'definition-proposal-revision'
    )
    when mapping_source_kind = 'parameter-subject' then new.target_kind in (
      'catalog-subject', 'subject-registration'
    )
    when mapping_source_kind in (
      'parameter-module',
      'parameter-placement',
      'parameter-module-mapping',
      'parameter-module-dismissed-compatible'
    ) then new.target_kind in ('subject-placement', 'review-evidence')
    when mapping_source_kind in (
      'driver-schema-overlay',
      'driver-schema-overlay-property',
      'driver-schema-overlay-promotion'
    ) then new.target_kind in (
      'definition-proposal', 'definition-proposal-revision', 'publication-intent'
    )
    when mapping_source_kind in (
      'dts-config-revision',
      'dts-logical-node',
      'dts-logical-node-revision',
      'dts-node-occurrence',
      'dts-property-occurrence',
      'dts-occurrence-effect',
      'dts-property-occurrence-spec-decision'
    ) then new.target_kind in (
      'parameter-observation', 'observation-match', 'review-evidence'
    )
    when mapping_source_kind in (
      'project-parameter-binding', 'project-parameter-binding-revision'
    ) then new.target_kind in (
      'parameter-binding', 'project-value', 'binding-history-event'
    )
    when mapping_source_kind in (
      'legacy-flat-parameter-definition', 'legacy-flat-project-parameter-value'
    ) then new.target_kind in ('parameter-definition', 'project-value')
    when mapping_source_kind in (
      'parameter-draft',
      'parameter-submission-round',
      'parameter-submission-item',
      'parameter-change-request',
      'parameter-review-decision',
      'parameter-spec-review-task',
      'parameter-spec-matcher-override'
    ) then new.target_kind in (
      'definition-proposal',
      'definition-proposal-revision',
      'review-item',
      'review-resolution',
      'review-evidence'
    )
    when mapping_source_kind in (
      'parameter-file-sync-conflict',
      'parameter-import-batch',
      'project-parameter-initialization-draft',
      'project-parameter-initialization-review'
    ) then new.target_kind in (
      'project-value', 'review-evidence', 'definition-proposal'
    )
    when mapping_source_kind in (
      'parameter-definition-reconciliation-run',
      'parameter-definition-reconciliation-item',
      'parameter-spec-version-cutover-run',
      'parameter-spec-version-cutover-item',
      'parameter-spec-property-key-cutover-run',
      'parameter-spec-property-key-cutover-item',
      'parameter-identity-migration-run',
      'parameter-identity-migration-phase',
      'parameter-identity-cutover',
      'parameter-history-entry',
      'legacy-parameter-migration-evidence'
    ) then new.target_kind in (
      'migration-history',
      'review-evidence',
      'parameter-observation',
      'observation-match',
      'audit-event'
    )
    when mapping_source_kind = 'parameter-policy-target' then new.target_kind = 'policy'
    when mapping_source_kind = 'audit-subject-link' then new.target_kind = 'audit-event'
    -- An unresolved protected reference is evidence for an Archive blocker;
    -- it can never be converted into a typed operational target.
    when mapping_source_kind = 'unresolved-protected-reference' then false
    else false
  end;

  if not coalesce(target_compatible, false) then
    raise exception using
      errcode = '23514',
      message = 'Legacy identity source kind is incompatible with its typed target',
      constraint = 'legacy_mapping_source_target_ck';
  end if;

  case new.target_kind
    when 'catalog-subject' then
      select exists (select 1 from parameter_catalog.catalog_subjects where id = new.target_id) into target_exists;
      target_owner_scope_kind := 'platform';
      target_owner_scope_id := 'platform';
    when 'parameter-definition' then
      select exists (select 1 from parameter_catalog.parameter_definitions where id = new.target_id) into target_exists;
      target_owner_scope_kind := 'platform';
      target_owner_scope_id := 'platform';
    when 'definition-revision' then
      select exists (select 1 from parameter_catalog.definition_revisions where id = new.target_id) into target_exists;
      target_owner_scope_kind := 'platform';
      target_owner_scope_id := 'platform';
    when 'subject-registration' then
      select organization_id into target_owner_scope_id
      from parameter_catalog.organization_subject_registrations where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'subject-placement' then
      select organization_id into target_owner_scope_id
      from parameter_catalog.subject_placements where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'parameter-binding' then
      select project_id into target_owner_scope_id
      from parameter_catalog.project_parameter_bindings where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'project';
    when 'project-value' then
      select binding.project_id into target_owner_scope_id
      from parameter_catalog.project_parameter_values value
      join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
      where value.id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'project';
    when 'binding-history-event' then
      select binding.project_id into target_owner_scope_id
      from parameter_catalog.binding_history_events history
      join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
      where history.id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'project';
    when 'parameter-observation' then
      select
        case when mapping_owner_scope_kind = 'project' then project_id else organization_id end
      into target_owner_scope_id
      from parameter_catalog.parameter_observations
      where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := case
        when mapping_owner_scope_kind = 'project' then 'project'
        else 'organization'
      end;
    when 'observation-match' then
      select
        case when mapping_owner_scope_kind = 'project' then project_id else organization_id end
      into target_owner_scope_id
      from parameter_catalog.parameter_observation_matches
      where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := case
        when mapping_owner_scope_kind = 'project' then 'project'
        else 'organization'
      end;
    when 'review-evidence' then
      select organization_id into target_owner_scope_id
      from parameter_catalog.parameter_review_evidence where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'review-item' then
      select organization_id into target_owner_scope_id
      from parameter_catalog.parameter_review_items where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'review-resolution' then
      select item.organization_id into target_owner_scope_id
      from parameter_catalog.parameter_review_resolutions resolution
      join parameter_catalog.parameter_review_items item on item.id = resolution.review_item_id
      where resolution.id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'definition-proposal' then
      select organization_id into target_owner_scope_id
      from parameter_catalog.definition_proposals where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'definition-proposal-revision' then
      select proposal.organization_id into target_owner_scope_id
      from parameter_catalog.definition_proposal_revisions revision
      join parameter_catalog.definition_proposals proposal on proposal.id = revision.proposal_id
      where revision.id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'publication-intent' then
      select proposal.organization_id into target_owner_scope_id
      from parameter_catalog.catalog_publication_intents intent
      join parameter_catalog.definition_proposals proposal on proposal.id = intent.proposal_id
      where intent.id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'policy' then
      select organization_id into target_owner_scope_id
      from public.parameter_policy_targets where id = new.target_id;
      target_exists := found;
      target_owner_scope_kind := 'organization';
    when 'audit-event' then
      select
        case when project_id is not null then project_id else organization_id end,
        case when project_id is not null then 'project' else 'organization' end
      into target_owner_scope_id, target_owner_scope_kind
      from public.audit_events where id = new.target_id;
      target_exists := found;
    when 'migration-history' then
      select id
      into target_owner_scope_id
      from parameter_catalog.parameter_catalog_cutover_runs
      where id = new.target_id;
      if found then
        target_exists := true;
      else
        select cutover_run_id
        into target_owner_scope_id
        from parameter_catalog.parameter_catalog_cutover_events
        where id = new.target_id;
        if found then
          target_exists := true;
        else
          select cutover_run_id
          into target_owner_scope_id
          from parameter_catalog.parameter_catalog_cutover_checkpoints
          where cutover_run_id = new.target_id
          limit 1;
          target_exists := found;
        end if;
      end if;
      target_owner_scope_kind := 'platform';
      target_owner_scope_id := 'platform';
    else
      target_exists := false;
  end case;

  if not target_exists then
    raise exception using
      errcode = '23503',
      message = 'Legacy mapping target does not exist',
      constraint = 'legacy_mapping_target_fk';
  end if;

  -- Platform Catalog and cutover-history targets may be pinned by any class-legal
  -- source. Same-Organization/Project checks apply only to org/project aggregates.
  if target_owner_scope_kind = 'platform' then
    return null;
  end if;

  if mapping_owner_scope_kind = 'project' and target_owner_scope_kind = 'organization' then
    select organization_id
    into mapping_owner_scope_id
    from public.projects
    where id = mapping_owner_scope_id;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'Legacy mapping target belongs to another owner scope',
        constraint = 'legacy_mapping_target_owner_fk';
    end if;
    mapping_owner_scope_kind := 'organization';
  end if;

  if mapping_owner_scope_kind is distinct from target_owner_scope_kind
     or mapping_owner_scope_id is distinct from target_owner_scope_id then
    raise exception using
      errcode = '23503',
      message = 'Legacy mapping target belongs to another owner scope',
      constraint = 'legacy_mapping_target_owner_fk';
  end if;

  return null;
end;
$$;

create constraint trigger legacy_mapping_target_fk
after insert or update of target_kind, target_id
on parameter_catalog.legacy_mapping_versions
deferrable initially deferred
for each row execute function parameter_catalog.assert_legacy_mapping_target_exists();

create table parameter_catalog.legacy_mapping_heads (
  legacy_identity_id text primary key references parameter_catalog.legacy_identities(id) on delete restrict,
  current_version_id text not null,
  cas_version bigint not null check (cas_version > 0),
  updated_at timestamptz not null default now(),
  foreign key (legacy_identity_id, current_version_id)
    references parameter_catalog.legacy_mapping_versions(legacy_identity_id, id)
    on delete restrict
    deferrable initially deferred
);

alter table parameter_catalog.binding_history_events
  add constraint binding_history_legacy_mapping_version_fk
  foreign key (legacy_mapping_version_id)
  references parameter_catalog.legacy_mapping_versions(id)
  on delete restrict;

create table parameter_catalog.parameter_catalog_classification_ledger (
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  legacy_identity_id text not null references parameter_catalog.legacy_identities(id) on delete restrict,
  r_class text not null check (r_class ~ '^R(?:[0-9]|10)$'),
  classifier_version text not null check (classifier_version <> '' and btrim(classifier_version) = classifier_version),
  graph_fingerprint text not null check (graph_fingerprint <> '' and btrim(graph_fingerprint) = graph_fingerprint),
  disposition text not null check (disposition in ('blocked', 'mapped', 'archived', 'review-evidence', 'definition-proposal')),
  mapping_version_id text,
  classified_at timestamptz not null default now(),
  primary key (cutover_run_id, legacy_identity_id),
  check ((disposition = 'blocked' and mapping_version_id is null) or (disposition <> 'blocked' and mapping_version_id is not null)),
  foreign key (mapping_version_id, legacy_identity_id, cutover_run_id)
    references parameter_catalog.legacy_mapping_versions(id, legacy_identity_id, cutover_run_id)
    on delete restrict
);

create table parameter_catalog.parameter_catalog_comparison_cases (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  gate_id text not null check (gate_id ~ '^PCAT-CMP-D0[1-9]$'),
  consumer_family text not null check (consumer_family <> '' and btrim(consumer_family) = consumer_family),
  case_key text not null check (case_key <> '' and btrim(case_key) = case_key),
  protected_reference boolean not null,
  unique (cutover_run_id, gate_id, consumer_family, case_key)
);

create table parameter_catalog.parameter_catalog_comparison_results (
  comparison_case_id text primary key references parameter_catalog.parameter_catalog_comparison_cases(id) on delete restrict,
  outcome text not null check (outcome in ('exact-equivalent', 'declared-expected-difference', 'unexplained-difference', 'unqueryable/protected-reference-missing')),
  mapping_version_id text references parameter_catalog.legacy_mapping_versions(id) on delete restrict,
  rule_id text,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  compared_at timestamptz not null default now(),
  check (
    (outcome = 'declared-expected-difference' and mapping_version_id is not null and rule_id is not null) or
    (outcome <> 'declared-expected-difference' and mapping_version_id is null and rule_id is null)
  )
);

create function parameter_catalog.assert_comparison_result_mapping_run()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  comparison_run_id text;
  mapping_run_id text;
begin
  if new.mapping_version_id is null then
    return null;
  end if;

  select cutover_run_id into comparison_run_id
  from parameter_catalog.parameter_catalog_comparison_cases
  where id = new.comparison_case_id;

  select cutover_run_id into mapping_run_id
  from parameter_catalog.legacy_mapping_versions
  where id = new.mapping_version_id;

  if comparison_run_id is not null
     and mapping_run_id is not null
     and comparison_run_id is distinct from mapping_run_id then
    raise exception using
      errcode = '23503',
      message = 'Comparison result mapping version belongs to another CutoverRun',
      constraint = 'comparison_result_mapping_run_fk';
  end if;

  return null;
end;
$$;

create constraint trigger comparison_result_mapping_run_fk
after insert or update of comparison_case_id, mapping_version_id
on parameter_catalog.parameter_catalog_comparison_results
deferrable initially deferred
for each row execute function parameter_catalog.assert_comparison_result_mapping_run();

create table parameter_catalog.catalog_command_idempotency (
  command_scope text not null check (command_scope in ('catalog-kernel', 'catalog-cutover')),
  idempotency_key text not null check (idempotency_key <> '' and btrim(idempotency_key) = idempotency_key),
  request_fingerprint text not null check (request_fingerprint <> '' and btrim(request_fingerprint) = request_fingerprint),
  state text not null check (state in ('pending', 'committed')),
  result_kind text,
  result_ref text,
  committed_at timestamptz,
  primary key (command_scope, idempotency_key),
  check (
    (state = 'pending' and result_kind is null and result_ref is null and committed_at is null) or
    (state = 'committed' and result_kind is not null and result_ref is not null and committed_at is not null)
  )
);

create function parameter_catalog.protect_command_idempotency()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = format('%I.%I rows cannot be deleted', tg_table_schema, tg_table_name);
  end if;

  if new.request_fingerprint is distinct from old.request_fingerprint then
    raise exception using
      errcode = '55000',
      message = 'Idempotency request fingerprint is immutable';
  end if;

  if tg_table_name = 'catalog_command_idempotency' then
    if new.command_scope is distinct from old.command_scope
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception using errcode = '55000', message = 'Catalog idempotency identity is immutable';
    end if;
  else
    if new.organization_id is distinct from old.organization_id
       or new.command_family is distinct from old.command_family
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception using errcode = '55000', message = 'Governance idempotency identity is immutable';
    end if;
  end if;

  if old.state = 'committed' then
    raise exception using
      errcode = '55000',
      message = 'Committed idempotency results cannot be mutated';
  end if;

  if old.state = 'pending' and new.state is distinct from 'committed' then
    raise exception using
      errcode = '55000',
      message = 'Pending idempotency rows may only commit';
  end if;

  return new;
end;
$$;

create trigger catalog_command_idempotency_protect
before update or delete on parameter_catalog.catalog_command_idempotency
for each row execute function parameter_catalog.protect_command_idempotency();

create function parameter_catalog.protect_cutover_run_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Catalog cutover runs cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.source_snapshot_fingerprint is distinct from old.source_snapshot_fingerprint
     or new.target_artifact_sha is distinct from old.target_artifact_sha
     or new.target_catalog_release_digest is distinct from old.target_catalog_release_digest
     or new.migration_contract_version is distinct from old.migration_contract_version
     or new.plan_digest is distinct from old.plan_digest
     or (old.pointer_rollback_closed_at is not null and new.pointer_rollback_closed_at is distinct from old.pointer_rollback_closed_at) then
    raise exception using errcode = '55000', message = 'Catalog cutover identity and rollback closure are immutable';
  end if;
  return new;
end;
$$;

create trigger parameter_catalog_cutover_run_identity_immutable
before update or delete on parameter_catalog.parameter_catalog_cutover_runs
for each row execute function parameter_catalog.protect_cutover_run_identity();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'legacy_identities',
    'parameter_catalog_cutover_events',
    'parameter_catalog_cutover_checkpoints',
    'parameter_catalog_archives',
    'legacy_mapping_versions',
    'parameter_catalog_classification_ledger',
    'parameter_catalog_comparison_cases',
    'parameter_catalog_comparison_results'
  ] loop
    execute format(
      'create trigger %I before update or delete on parameter_catalog.%I for each row execute function parameter_catalog.reject_immutable_catalog_change()',
      relation_name || '_immutable',
      relation_name
    );
  end loop;
end;
$$;

create function parameter_catalog.assert_catalog_subject_active(
  p_expected_release_id text,
  p_expected_release_digest text,
  p_subject_id text,
  p_expected_membership text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  current_release_id text;
  current_release_digest text;
  current_state_count integer;
  membership_lifecycle text;
  previous_lock_timeout text;
begin
  if p_expected_release_id is null
     or p_expected_release_id = ''
     or btrim(p_expected_release_id) <> p_expected_release_id
     or p_expected_release_id ~ '[[:cntrl:]]'
     or p_expected_release_digest is null
     or p_expected_release_digest = ''
     or btrim(p_expected_release_digest) <> p_expected_release_digest
     or p_expected_release_digest ~ '[[:cntrl:]]'
     or p_subject_id is null
     or p_subject_id = ''
     or btrim(p_subject_id) <> p_subject_id
     or p_subject_id ~ '[[:cntrl:]]'
     or p_expected_membership is distinct from 'active' then
    raise exception using
      errcode = 'PCA04',
      message = 'Catalog current-release guard input or state is invalid',
      detail = 'PCAT-GUARD-DRIFT';
  end if;

  previous_lock_timeout := pg_catalog.current_setting('lock_timeout');
  perform pg_catalog.set_config('lock_timeout', '2s', true);
  begin
    perform pg_catalog.pg_advisory_xact_lock_shared(688004000041::bigint);
  exception
    when lock_not_available then
      perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
      raise exception using
        errcode = 'PCA05',
        message = 'catalog current-pointer serialization timed out',
        detail = 'PCAT-GUARD-SYNCHRONIZATION-BUSY';
  end;
  perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);

  select count(*), min(state.current_catalog_release_id), min(release.release_digest)
  into current_state_count, current_release_id, current_release_digest
  from parameter_catalog.catalog_state state
  left join parameter_catalog.catalog_releases release
    on release.id = state.current_catalog_release_id;

  if current_state_count <> 1 or current_release_id is null or current_release_digest is null then
    raise exception using
      errcode = 'PCA04',
      message = 'Catalog current-release projection is unavailable',
      detail = 'PCAT-GUARD-DRIFT';
  end if;

  if current_release_id <> p_expected_release_id
     or current_release_digest <> p_expected_release_digest then
    raise exception using
      errcode = 'PCA01',
      message = 'Catalog release pin does not match current state',
      detail = 'PCAT-GUARD-RELEASE-MISMATCH';
  end if;

  select lifecycle into membership_lifecycle
  from parameter_catalog.catalog_release_subjects
  where release_id = current_release_id
    and catalog_release_subjects.subject_id = p_subject_id;

  if not found then
    raise exception using
      errcode = 'PCA02',
      message = 'Catalog subject is not published in the current release',
      detail = 'PCAT-GUARD-SUBJECT-NOT-PUBLISHED';
  end if;

  if membership_lifecycle = 'retired' then
    raise exception using
      errcode = 'PCA03',
      message = 'Catalog subject is retired in the current release',
      detail = 'PCAT-GUARD-SUBJECT-RETIRED';
  end if;

  if membership_lifecycle <> 'active' then
    raise exception using
      errcode = 'PCA04',
      message = 'Catalog subject membership is invalid',
      detail = 'PCAT-GUARD-DRIFT';
  end if;
end;
$$;

revoke all on function parameter_catalog.assert_catalog_subject_active(text, text, text, text) from public;

comment on function parameter_catalog.assert_catalog_subject_active(text, text, text, text) is
  'Execute-only current Catalog guard. Stable SQLSTATE/detail pairs: PCA01 release mismatch, PCA02 not published, PCA03 retired, PCA04 drift, PCA05 synchronization busy.';

-- Organization governance projection.
create table parameter_catalog.organization_subject_registrations (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  subject_id text not null references parameter_catalog.catalog_subjects(id) on delete restrict,
  status text not null check (status in ('active', 'retired')),
  registration_method text not null check (registration_method in ('explicit', 'automatic', 'review')),
  proof jsonb not null check (jsonb_typeof(proof) = 'object'),
  current_placement_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, subject_id),
  unique (id, organization_id),
  unique (id, organization_id, subject_id)
);

create table parameter_catalog.subject_placements (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  registration_id text not null,
  organization_id text not null,
  module_id text not null,
  origin text not null check (origin in ('auto', 'curated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id),
  unique (registration_id, id),
  unique (organization_id, module_id),
  foreign key (registration_id, organization_id)
    references parameter_catalog.organization_subject_registrations(id, organization_id)
    on delete restrict
    deferrable initially deferred,
  foreign key (module_id, organization_id)
    references public.parameter_modules(id, organization_id)
    on delete restrict
);

create function parameter_catalog.lock_subject_placement_module()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  perform 1
  from public.parameter_modules
  where id = new.module_id
    and organization_id = new.organization_id
  for share;

  return new;
end;
$$;

revoke all on function parameter_catalog.lock_subject_placement_module() from public;

create trigger subject_placement_module_lock
before insert or update of module_id, organization_id
on parameter_catalog.subject_placements
for each row execute function parameter_catalog.lock_subject_placement_module();

alter table parameter_catalog.organization_subject_registrations
  add constraint registration_current_placement_fk
  foreign key (id, current_placement_id)
  references parameter_catalog.subject_placements(registration_id, id)
  on delete restrict
  deferrable initially deferred;

create function parameter_catalog.assert_subject_placement_kind()
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
     or (subject_kind = 'node-type' and module_kind <> 'node-type') then
    raise exception using
      errcode = '23514',
      message = 'Subject placement kind does not match Catalog subject kind',
      constraint = 'subject_placement_kind_ck';
  end if;

  return null;
end;
$$;

create constraint trigger subject_placement_kind_ck
after insert or update of registration_id, organization_id, module_id
on parameter_catalog.subject_placements
deferrable initially deferred
for each row execute function parameter_catalog.assert_subject_placement_kind();

create function parameter_catalog.assert_parameter_module_placement_kind()
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
        (subject.kind = 'node-type' and new.kind <> 'node-type')
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

revoke all on function parameter_catalog.assert_parameter_module_placement_kind() from public;

create constraint trigger parameter_module_placement_kind_ck
after update of kind on public.parameter_modules
deferrable initially deferred
for each row execute function parameter_catalog.assert_parameter_module_placement_kind();

create table parameter_catalog.parameter_observations (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  project_id text not null,
  logical_node_id text not null check (logical_node_id <> '' and btrim(logical_node_id) = logical_node_id),
  config_revision_id text not null check (config_revision_id <> '' and btrim(config_revision_id) = config_revision_id),
  source_identity text not null check (source_identity <> '' and btrim(source_identity) = source_identity),
  source_locator jsonb not null check (jsonb_typeof(source_locator) = 'object'),
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  matcher_revision text not null check (matcher_revision <> '' and btrim(matcher_revision) = matcher_revision),
  evidence_fingerprint text not null check (evidence_fingerprint <> '' and btrim(evidence_fingerprint) = evidence_fingerprint),
  observed_at timestamptz not null default now(),
  unique (organization_id, source_identity),
  unique (id, organization_id),
  unique (id, organization_id, catalog_release_id, matcher_revision),
  unique (
    id, organization_id, catalog_release_id, matcher_revision,
    project_id, logical_node_id
  ),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete restrict
);

create table parameter_catalog.parameter_review_evidence (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  observation_id text,
  reason text not null check (reason in ('unknown', 'ambiguous', 'placement-conflict', 'retired-registration-observed')),
  candidate_safe_digest text not null check (candidate_safe_digest <> '' and btrim(candidate_safe_digest) = candidate_safe_digest),
  r_class text check (r_class is null or r_class ~ '^R(?:[0-9]|10)$'),
  source_graph_ref text,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (observation_id, organization_id)
    references parameter_catalog.parameter_observations(id, organization_id)
    on delete restrict
);

create table parameter_catalog.parameter_review_items (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  evidence_fingerprint text not null check (evidence_fingerprint <> '' and btrim(evidence_fingerprint) = evidence_fingerprint),
  matcher_revision text not null check (matcher_revision <> '' and btrim(matcher_revision) = matcher_revision),
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  reason text not null check (reason in ('unknown', 'ambiguous', 'placement-conflict', 'retired-registration-observed')),
  status text not null check (status in ('open', 'resolved', 'out-of-scope')),
  etag_version bigint not null check (etag_version > 0),
  current_resolution_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (
    (status = 'open' and current_resolution_id is null) or
    (status in ('resolved', 'out-of-scope') and current_resolution_id is not null)
  )
);

create unique index parameter_review_items_open_group_unique
  on parameter_catalog.parameter_review_items(organization_id, matcher_revision, evidence_fingerprint)
  where status = 'open';

create table parameter_catalog.definition_proposals (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  author_principal_id text not null check (author_principal_id <> '' and btrim(author_principal_id) = author_principal_id),
  base_catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  base_definition_revision_id text references parameter_catalog.definition_revisions(id) on delete restrict,
  status text not null check (status in ('draft', 'submitted', 'accepted', 'rejected', 'withdrawn')),
  current_proposal_revision_id text not null,
  etag_version bigint not null check (etag_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, base_catalog_release_id)
);

create table parameter_catalog.definition_proposal_revisions (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  proposal_id text not null references parameter_catalog.definition_proposals(id) on delete restrict,
  revision_number bigint not null check (revision_number > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  reason text not null check (reason <> '' and btrim(reason) = reason),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array'),
  created_at timestamptz not null default now(),
  unique (proposal_id, revision_number),
  unique (proposal_id, id)
);

alter table parameter_catalog.definition_proposals
  add constraint definition_proposal_current_revision_fk
  foreign key (id, current_proposal_revision_id)
  references parameter_catalog.definition_proposal_revisions(proposal_id, id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.catalog_publication_intents (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  proposal_id text not null unique references parameter_catalog.definition_proposals(id) on delete restrict,
  proposal_revision_id text not null,
  base_catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  repository_reference text not null check (repository_reference <> '' and btrim(repository_reference) = repository_reference),
  reviewer_principal_id text not null check (reviewer_principal_id <> '' and btrim(reviewer_principal_id) = reviewer_principal_id),
  success_audit_ref text not null check (success_audit_ref <> '' and btrim(success_audit_ref) = success_audit_ref),
  created_at timestamptz not null default now(),
  foreign key (proposal_id, proposal_revision_id)
    references parameter_catalog.definition_proposal_revisions(proposal_id, id)
    on delete restrict,
  constraint catalog_publication_intent_proposal_base_fk
    foreign key (proposal_id, base_catalog_release_id)
    references parameter_catalog.definition_proposals(id, base_catalog_release_id)
    on delete restrict
);

create table parameter_catalog.parameter_review_resolutions (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  review_item_id text not null unique references parameter_catalog.parameter_review_items(id) on delete restrict,
  resolution_type text not null check (resolution_type in ('register-subject', 'restore-registration', 'mark-out-of-scope', 'open-definition-proposal')),
  before_etag_version bigint not null check (before_etag_version > 0),
  after_etag_version bigint not null check (after_etag_version > before_etag_version),
  accountable_principal_id text not null check (accountable_principal_id <> '' and btrim(accountable_principal_id) = accountable_principal_id),
  initiator_type text not null check (initiator_type in ('user', 'system')),
  captured_catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  request_fingerprint text not null check (request_fingerprint <> '' and btrim(request_fingerprint) = request_fingerprint),
  registration_id text references parameter_catalog.organization_subject_registrations(id) on delete restrict,
  proposal_id text references parameter_catalog.definition_proposals(id) on delete restrict,
  out_of_scope_reason text,
  success_audit_ref text not null check (success_audit_ref <> '' and btrim(success_audit_ref) = success_audit_ref),
  created_at timestamptz not null default now(),
  unique (review_item_id, id),
  check (
    (resolution_type in ('register-subject', 'restore-registration') and registration_id is not null and proposal_id is null and out_of_scope_reason is null) or
    (resolution_type = 'open-definition-proposal' and registration_id is null and proposal_id is not null and out_of_scope_reason is null) or
    (resolution_type = 'mark-out-of-scope' and registration_id is null and proposal_id is null and out_of_scope_reason is not null)
  )
);

create function parameter_catalog.assert_review_resolution_target_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  review_organization_id text;
  target_organization_id text;
begin
  select organization_id into review_organization_id
  from parameter_catalog.parameter_review_items
  where id = new.review_item_id;

  if new.registration_id is not null then
    select organization_id into target_organization_id
    from parameter_catalog.organization_subject_registrations
    where id = new.registration_id;
  elsif new.proposal_id is not null then
    select organization_id into target_organization_id
    from parameter_catalog.definition_proposals
    where id = new.proposal_id;
  else
    return null;
  end if;

  if review_organization_id is not null
     and target_organization_id is not null
     and review_organization_id is distinct from target_organization_id then
    raise exception using
      errcode = '23503',
      message = 'Review resolution target belongs to another Organization',
      constraint = 'review_resolution_target_owner_fk';
  end if;

  return null;
end;
$$;

create constraint trigger review_resolution_target_owner_fk
after insert or update of review_item_id, registration_id, proposal_id
on parameter_catalog.parameter_review_resolutions
deferrable initially deferred
for each row execute function parameter_catalog.assert_review_resolution_target_owner();

alter table parameter_catalog.parameter_review_items
  add constraint parameter_review_item_current_resolution_fk
  foreign key (id, current_resolution_id)
  references parameter_catalog.parameter_review_resolutions(review_item_id, id)
  on delete restrict
  deferrable initially deferred;

create table parameter_catalog.governance_command_idempotency (
  organization_id text not null references public.organizations(id) on delete restrict,
  command_family text not null check (command_family <> '' and btrim(command_family) = command_family),
  idempotency_key text not null check (idempotency_key <> '' and btrim(idempotency_key) = idempotency_key),
  request_fingerprint text not null check (request_fingerprint <> '' and btrim(request_fingerprint) = request_fingerprint),
  state text not null check (state in ('pending', 'committed')),
  result_kind text,
  result_ref text,
  committed_at timestamptz,
  primary key (organization_id, command_family, idempotency_key),
  check (
    (state = 'pending' and result_kind is null and result_ref is null and committed_at is null) or
    (state = 'committed' and result_kind is not null and result_ref is not null and committed_at is not null)
  )
);

create trigger governance_command_idempotency_protect
before update or delete on parameter_catalog.governance_command_idempotency
for each row execute function parameter_catalog.protect_command_idempotency();

create table parameter_catalog.parameter_observation_matches (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  observation_id text not null unique,
  organization_id text not null,
  project_id text not null,
  logical_node_id text not null check (logical_node_id <> '' and btrim(logical_node_id) = logical_node_id),
  registration_id text not null,
  subject_id text not null,
  definition_id text not null,
  definition_revision_id text not null,
  binding_id text not null check (binding_id <> '' and btrim(binding_id) = binding_id),
  catalog_release_id text not null references parameter_catalog.catalog_releases(id) on delete restrict,
  matcher_revision text not null check (matcher_revision <> '' and btrim(matcher_revision) = matcher_revision),
  matched_at timestamptz not null default now(),
  constraint parameter_observation_match_observation_fk
    foreign key (
      observation_id, organization_id, catalog_release_id, matcher_revision,
      project_id, logical_node_id
    )
    references parameter_catalog.parameter_observations(
      id, organization_id, catalog_release_id, matcher_revision,
      project_id, logical_node_id
    )
    on delete restrict,
  foreign key (registration_id, organization_id, subject_id)
    references parameter_catalog.organization_subject_registrations(id, organization_id, subject_id)
    on delete restrict,
  foreign key (definition_id, subject_id)
    references parameter_catalog.parameter_definitions(id, subject_id)
    on delete restrict,
  foreign key (definition_id, definition_revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict,
  constraint parameter_observation_match_release_revision_fk
    foreign key (catalog_release_id, definition_id, definition_revision_id)
    references parameter_catalog.catalog_release_definition_heads(
      release_id, definition_id, revision_id
    )
    on delete restrict,
  constraint parameter_observation_match_binding_fk
    foreign key (
      binding_id, organization_id, project_id, logical_node_id,
      registration_id, subject_id, definition_id
    )
    references parameter_catalog.project_parameter_bindings(
      id, organization_id, project_id, logical_node_id,
      registration_id, subject_id, definition_id
    )
    on delete restrict
);

create function parameter_catalog.assert_observation_match_binding_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if not exists (
    select 1
    from parameter_catalog.project_parameter_bindings binding
    where binding.id = new.binding_id
      and binding.definition_id = new.definition_id
      and binding.catalog_release_id = new.catalog_release_id
      and binding.effective_revision_id = new.definition_revision_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Observation match release and revision must equal the Binding capture at acceptance',
      constraint = 'parameter_observation_match_binding_revision_fk';
  end if;

  return null;
end;
$$;

-- Agreement is checked at acceptance time only.  The match is immutable
-- historical evidence, so a later governed Binding cutover must not rewrite
-- it or be blocked by a permanent FK to the Binding's mutable revision head.
create constraint trigger parameter_observation_match_binding_revision_fk
after insert on parameter_catalog.parameter_observation_matches
deferrable initially deferred
for each row execute function parameter_catalog.assert_observation_match_binding_revision();

create function parameter_catalog.protect_registration_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Subject registrations cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.subject_id is distinct from old.subject_id
     or new.registration_method is distinct from old.registration_method
     or new.proof is distinct from old.proof
     or new.current_placement_id is distinct from old.current_placement_id then
    raise exception using errcode = '55000', message = 'Subject registration identity and retained placement are immutable';
  end if;
  return new;
end;
$$;

create trigger organization_subject_registration_identity_immutable
before update or delete on parameter_catalog.organization_subject_registrations
for each row execute function parameter_catalog.protect_registration_identity();

create function parameter_catalog.protect_subject_placement_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Subject placements cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.registration_id is distinct from old.registration_id
     or new.organization_id is distinct from old.organization_id then
    raise exception using errcode = '55000', message = 'Subject placement identity is immutable';
  end if;
  return new;
end;
$$;

create trigger subject_placement_identity_immutable
before update or delete on parameter_catalog.subject_placements
for each row execute function parameter_catalog.protect_subject_placement_identity();

create function parameter_catalog.protect_review_item_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Review items cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.evidence_fingerprint is distinct from old.evidence_fingerprint
     or new.matcher_revision is distinct from old.matcher_revision
     or new.catalog_release_id is distinct from old.catalog_release_id
     or new.reason is distinct from old.reason then
    raise exception using errcode = '55000', message = 'Review item evidence identity is immutable';
  end if;
  return new;
end;
$$;

create trigger parameter_review_item_identity_immutable
before update or delete on parameter_catalog.parameter_review_items
for each row execute function parameter_catalog.protect_review_item_identity();

create function parameter_catalog.protect_proposal_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Definition proposals cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.author_principal_id is distinct from old.author_principal_id
     or new.base_catalog_release_id is distinct from old.base_catalog_release_id
     or new.base_definition_revision_id is distinct from old.base_definition_revision_id then
    raise exception using errcode = '55000', message = 'Definition proposal identity and base are immutable';
  end if;
  return new;
end;
$$;

create trigger definition_proposal_identity_immutable
before update or delete on parameter_catalog.definition_proposals
for each row execute function parameter_catalog.protect_proposal_identity();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'parameter_observations',
    'parameter_observation_matches',
    'parameter_review_evidence',
    'parameter_review_resolutions',
    'definition_proposal_revisions',
    'catalog_publication_intents'
  ] loop
    execute format(
      'create trigger %I before update or delete on parameter_catalog.%I for each row execute function parameter_catalog.reject_immutable_catalog_change()',
      relation_name || '_immutable',
      relation_name
    );
  end loop;
end;
$$;

alter table parameter_catalog.project_parameter_bindings
  add constraint project_parameter_binding_registration_fk
  foreign key (registration_id, organization_id, subject_id)
  references parameter_catalog.organization_subject_registrations(id, organization_id, subject_id)
  on delete restrict;

do $$
declare
  fn_signature text;
begin
  for fn_signature in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_catalog.pg_get_function_identity_arguments(proc.oid)
    )
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'parameter_catalog'
  loop
    execute format('revoke all on function %s from public', fn_signature);
  end loop;
end;
$$;
