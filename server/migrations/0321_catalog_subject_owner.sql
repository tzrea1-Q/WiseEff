-- A child node's driver is part of its permanent Catalog identity. Existing
-- releases remain owner-less until explicitly claimed by the synchronizer.
alter table parameter_catalog.catalog_state add column subject_owner_epoch bigint not null default 0;
alter table parameter_catalog.catalog_subjects add column owner_subject_id text;
grant select (subject_owner_epoch) on parameter_catalog.catalog_state to wiseeff_mod_d02_source_reader;
grant select (owner_subject_id) on parameter_catalog.catalog_subjects to wiseeff_mod_d02_source_reader;
alter table parameter_catalog.catalog_subjects add constraint catalog_subject_owner_node_ck
  check (owner_subject_id is null or kind = 'node-type');
alter table parameter_catalog.catalog_subjects add constraint catalog_subject_owner_driver_fk
  foreign key (owner_subject_id) references parameter_catalog.catalog_drivers(subject_id)
  on delete restrict deferrable initially deferred;
alter table parameter_catalog.catalog_subjects drop constraint catalog_subjects_kind_canonical_key_key;
create unique index catalog_subject_owner_key_unique on parameter_catalog.catalog_subjects
  (kind, coalesce(owner_subject_id, ''), canonical_key);

alter table parameter_catalog.catalog_subject_aliases add column owner_subject_id text;
alter table parameter_catalog.catalog_subject_aliases drop constraint catalog_subject_aliases_selector_kind_normalized_selector_key;
create unique index catalog_alias_owner_selector_unique on parameter_catalog.catalog_subject_aliases
  (selector_kind, coalesce(owner_subject_id, ''), normalized_selector);

create function parameter_catalog.set_catalog_alias_owner()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare actual_owner text;
begin
  select owner_subject_id into actual_owner from parameter_catalog.catalog_subjects where id = new.subject_id;
  if new.owner_subject_id is not null and new.owner_subject_id is distinct from actual_owner then
    raise exception using errcode = '23514', message = 'Catalog alias owner differs from subject owner';
  end if;
  new.owner_subject_id := actual_owner;
  return new;
end $$;
alter function parameter_catalog.set_catalog_alias_owner() owner to catalog_migration_owner;
revoke all on function parameter_catalog.set_catalog_alias_owner() from public;
create trigger aaa_catalog_alias_owner before insert on parameter_catalog.catalog_subject_aliases
  for each row execute function parameter_catalog.set_catalog_alias_owner();

create function parameter_catalog.assert_catalog_alias_owner()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if exists (
    select 1 from parameter_catalog.catalog_subject_aliases alias
    join parameter_catalog.catalog_subjects subject on subject.id = alias.subject_id
    where alias.id = new.id and alias.owner_subject_id is distinct from subject.owner_subject_id
  ) then
    raise exception using errcode = '23514', message = 'Catalog alias owner differs from subject owner',
      constraint = 'catalog_alias_owner_matches_subject_ck';
  end if;
  return null;
end $$;
alter function parameter_catalog.assert_catalog_alias_owner() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_catalog_alias_owner() from public;
create constraint trigger catalog_alias_owner_matches_subject_ck
  after insert or update on parameter_catalog.catalog_subject_aliases deferrable initially deferred
  for each row execute function parameter_catalog.assert_catalog_alias_owner();

create or replace function parameter_catalog.reject_cross_root_selector_collision()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare target_kind text; target_value text;
begin
  if tg_table_name = 'catalog_subjects' then
    target_kind := case new.kind when 'driver' then 'driver-compatible'
      when 'node-type' then 'node-type-name' when 'configuration-schema' then 'configuration-schema-id' end;
    target_value := new.canonical_key;
  else
    target_kind := new.selector_kind;
    target_value := new.normalized_selector;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(688005000001::bigint);
  if tg_table_name = 'catalog_subjects' and exists (
    select 1 from parameter_catalog.catalog_subject_aliases alias
    where alias.selector_kind = target_kind and alias.normalized_selector = target_value
      and alias.owner_subject_id is not distinct from new.owner_subject_id
  ) then
    raise exception using errcode = '23505', message = 'Catalog canonical selector collides with an alias root',
      constraint = 'catalog_selector_cross_root_unique_ck';
  end if;
  if tg_table_name = 'catalog_subject_aliases' and exists (
    select 1 from parameter_catalog.catalog_subjects subject
    where subject.kind = case target_kind when 'driver-compatible' then 'driver'
      when 'node-type-name' then 'node-type' when 'configuration-schema-id' then 'configuration-schema' end
      and subject.canonical_key = target_value
      and subject.owner_subject_id is not distinct from new.owner_subject_id
  ) then
    raise exception using errcode = '23505', message = 'Catalog alias collides with a canonical selector root',
      constraint = 'catalog_selector_cross_root_unique_ck';
  end if;
  return new;
end $$;

drop trigger catalog_subject_selector_cross_root_unique on parameter_catalog.catalog_subjects;
create trigger catalog_subject_selector_cross_root_unique before insert or update of kind, canonical_key, owner_subject_id
  on parameter_catalog.catalog_subjects for each row execute function parameter_catalog.reject_cross_root_selector_collision();
drop trigger catalog_subject_alias_selector_cross_root_unique on parameter_catalog.catalog_subject_aliases;
create trigger catalog_subject_alias_selector_cross_root_unique before insert or update of selector_kind, normalized_selector, owner_subject_id
  on parameter_catalog.catalog_subject_aliases for each row execute function parameter_catalog.reject_cross_root_selector_collision();

-- Preserve the existing projection checks while scoping their alias collision test.
do $migration$
declare definition text; needle constant text := 'on canonical_owner.canonical_key = alias.normalized_selector';
begin
  select pg_get_functiondef('parameter_catalog.assert_catalog_materialization_projection_complete()'::regprocedure) into strict definition;
  if position(needle in definition) = 0 then
    raise exception 'Catalog materialization alias collision check is missing';
  end if;
  execute replace(definition, needle, needle || E'\n     and canonical_owner.owner_subject_id is not distinct from alias.owner_subject_id');
  select pg_get_functiondef('parameter_catalog.assert_current_release_complete()'::regprocedure) into strict definition;
  if position(needle in definition) = 0 then
    raise exception 'Current Catalog release alias collision check is missing';
  end if;
  execute replace(definition, needle, needle || E'\n     and canonical_owner.owner_subject_id is not distinct from alias.owner_subject_id');
end $migration$;

create function parameter_catalog.protect_catalog_owner_identity()
returns trigger language plpgsql set search_path = pg_catalog, parameter_catalog as $$
begin
  if tg_op = 'DELETE' and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  if tg_op = 'UPDATE' and current_user = 'catalog_migration_owner'
     and old.owner_subject_id is null and new.owner_subject_id is not null
     and (to_jsonb(new) - 'owner_subject_id') = (to_jsonb(old) - 'owner_subject_id') then
    return new;
  end if;
  raise exception using errcode = '55000', message = format('%I.%I identity is immutable', tg_table_schema, tg_table_name);
end $$;
alter function parameter_catalog.protect_catalog_owner_identity() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_catalog_owner_identity() from public;
drop trigger catalog_subjects_immutable on parameter_catalog.catalog_subjects;
create trigger catalog_subjects_immutable before update or delete on parameter_catalog.catalog_subjects
  for each row execute function parameter_catalog.protect_catalog_owner_identity();
drop trigger catalog_subject_aliases_immutable on parameter_catalog.catalog_subject_aliases;
create trigger catalog_subject_aliases_immutable before update or delete on parameter_catalog.catalog_subject_aliases
  for each row execute function parameter_catalog.protect_catalog_owner_identity();

create function parameter_catalog.claim_catalog_subject_owner(subject_id text, owner_id text)
returns boolean language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare current_owner text; subject_kind text;
begin
  perform pg_catalog.pg_advisory_xact_lock(688005000001::bigint);
  select s.owner_subject_id, s.kind into current_owner, subject_kind
    from parameter_catalog.catalog_subjects s where s.id = subject_id for update;
  if not found or subject_kind <> 'node-type' or owner_id is null then
    raise exception using errcode = '23514', message = 'Invalid Catalog subject owner claim';
  end if;
  if current_owner is not null then
    if current_owner = owner_id then return false; end if;
    raise exception using errcode = '55000', message = 'Catalog subject owner is permanent';
  end if;
  update parameter_catalog.catalog_subjects set owner_subject_id = owner_id where id = subject_id;
  update parameter_catalog.catalog_subject_aliases set owner_subject_id = owner_id where catalog_subject_aliases.subject_id = claim_catalog_subject_owner.subject_id;
  update parameter_catalog.catalog_state set subject_owner_epoch = subject_owner_epoch + 1 where singleton;
  return true;
end $$;
alter function parameter_catalog.claim_catalog_subject_owner(text, text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.claim_catalog_subject_owner(text, text) from public;
grant execute on function parameter_catalog.claim_catalog_subject_owner(text, text) to catalog_synchronizer_role;
