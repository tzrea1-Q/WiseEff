-- Stable roots retain their introduction facts. Release memberships carry
-- the effective primary selector and alias owner for each publication.
alter table parameter_catalog.catalog_release_subject_aliases
  drop constraint catalog_release_subject_aliases_alias_id_subject_id_fkey,
  add constraint catalog_release_subject_aliases_alias_id_fkey
    foreign key (alias_id) references parameter_catalog.catalog_subject_aliases(id)
    on delete restrict deferrable initially deferred;

create function parameter_catalog.assert_catalog_identity_correction()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare previous_release text; previous_value text; next_value text;
begin
  select predecessor_release_id into previous_release from catalog_releases where id = new.release_id;
  if tg_table_name = 'catalog_release_subjects' then
    select coalesce(m.selector_snapshot->'values'->>0, m.selector_snapshot->>'value', s.canonical_key)
      into previous_value from catalog_subjects s
      left join catalog_release_subjects m on m.subject_id = s.id and m.release_id = previous_release
      where s.id = new.subject_id;
    next_value := coalesce(new.selector_snapshot->'values'->>0, new.selector_snapshot->>'value');
  else
    select coalesce(m.subject_id, a.subject_id) into previous_value from catalog_subject_aliases a
      left join catalog_release_subject_aliases m on m.alias_id = a.id and m.release_id = previous_release
      where a.id = new.alias_id;
    next_value := new.subject_id;
  end if;
  if next_value is not null and previous_value is distinct from next_value and
    (new.selector_provenance->>'source' is distinct from 'catalog-subject-identity-correction'
      or new.selector_provenance->>'reviewReference' is distinct from new.release_id) then
    raise exception using errcode = '23514', message = 'Catalog identity correction must identify its publication';
  end if;
  return null;
end $$;
alter function parameter_catalog.assert_catalog_identity_correction() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_catalog_identity_correction() from public;
create constraint trigger catalog_release_subject_identity_correction_ck
  after insert on parameter_catalog.catalog_release_subjects deferrable initially deferred
  for each row execute function parameter_catalog.assert_catalog_identity_correction();
create constraint trigger catalog_release_alias_identity_correction_ck
  after insert on parameter_catalog.catalog_release_subject_aliases deferrable initially deferred
  for each row execute function parameter_catalog.assert_catalog_identity_correction();

-- A subject may retain its introduction selector as an alias after a rename.
-- The release checks below still reject simultaneous primary and alias use.
do $migration$
declare definition text; name text;
  old_collision constant text := 'join parameter_catalog.catalog_subjects canonical_owner
      on canonical_owner.canonical_key = alias.normalized_selector
     and canonical_owner.owner_subject_id is not distinct from alias.owner_subject_id';
  new_collision constant text := 'join parameter_catalog.catalog_subjects alias_subject on alias_subject.id = release_alias.subject_id
    join parameter_catalog.catalog_release_subjects canonical_membership on canonical_membership.release_id = release_alias.release_id
    join parameter_catalog.catalog_subjects canonical_owner
      on canonical_owner.id = canonical_membership.subject_id
     and coalesce(canonical_membership.selector_snapshot->''values''->>0,
       canonical_membership.selector_snapshot->>''value'', canonical_owner.canonical_key) = alias.normalized_selector
     and canonical_owner.owner_subject_id is not distinct from alias_subject.owner_subject_id';
begin
  select pg_get_functiondef('parameter_catalog.reject_cross_root_selector_collision()'::regprocedure) into strict definition;
  execute replace(definition, 'and subject.canonical_key = target_value',
    'and subject.canonical_key = target_value and (
      subject.id is distinct from to_jsonb(new)->>''subject_id'' or not exists (
        select 1 from parameter_catalog.catalog_release_subjects membership
        where membership.subject_id = subject.id and membership.release_id = new.introduced_release_id
          and coalesce(membership.selector_snapshot->''values''->>0, membership.selector_snapshot->>''value'') <> target_value
      )
    )');
  foreach name in array array['assert_catalog_materialization_projection_complete', 'assert_current_release_complete'] loop
    select pg_get_functiondef(('parameter_catalog.' || name || '()')::regprocedure) into strict definition;
    if position(old_collision in definition) = 0 then
      raise exception 'Catalog alias collision check is missing from %', name;
    end if;
    execute replace(replace(definition, old_collision, new_collision),
      'join parameter_catalog.catalog_subjects subject on subject.id = alias.subject_id',
      'join parameter_catalog.catalog_subjects subject on subject.id = release_alias.subject_id');
  end loop;
end $migration$;
