-- Rules corrected through publication are stored on each release membership.
-- NULL identifies legacy rows backed by the original roots.
alter table parameter_catalog.catalog_release_subjects add column rules_snapshot jsonb;

-- Approval rechecks read only the registration, Binding and source columns
-- that determine the reviewed project impact.
grant select (id,organization_id,subject_id,status,cascade_retired,owner_subject_id)
  on parameter_catalog.organization_subject_registrations to catalog_synchronizer_role;
grant select (id,organization_id,project_id,subject_id,logical_node_id,source_occurrence_id)
  on parameter_catalog.current_project_parameter_bindings to catalog_synchronizer_role;
grant usage on schema public to catalog_synchronizer_role;
grant select (organization_id,registration_id,instance_cardinality,compatibles,node_type_name)
  on public.registration_recognition_rules to catalog_synchronizer_role;
grant select (organization_id,id,project_id) on public.dts_config_set to catalog_synchronizer_role;
grant select (id) on public.organizations to catalog_synchronizer_role;
grant select (id,project_id,organization_id,config_set_id,status,revision_number)
  on public.dts_config_revisions to catalog_synchronizer_role;
grant select (id,logical_node_id,name,compatible,config_revision_id)
  on public.dts_logical_node_revisions to catalog_synchronizer_role;
grant select (effect_kind,property_occurrence_id,logical_node_revision_id,config_revision_id,property_name,source_order)
  on public.dts_occurrence_effects to catalog_synchronizer_role;
grant select (id,raw_text) on public.dts_property_occurrences to catalog_synchronizer_role;
grant select (file_id,config_revision_id,file_version_id) on public.dts_config_revision_members to catalog_synchronizer_role;
grant select (id,current_version_id) on public.project_parameter_files to catalog_synchronizer_role;

create function parameter_catalog.assert_catalog_subject_release_rules()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare
  introduced catalog_subjects%rowtype;
  previous jsonb;
  previous_lifecycle text;
  owner_id text;
  defaults jsonb;
begin
  select * into strict introduced from catalog_subjects where id = new.subject_id;
  select membership.rules_snapshot, membership.lifecycle into previous, previous_lifecycle
    from catalog_releases release left join catalog_release_subjects membership
      on membership.release_id = release.predecessor_release_id and membership.subject_id = new.subject_id
    where release.id = new.release_id;
  if previous is not null and new.rules_snapshot is null then
    raise exception using errcode = '23514', message = 'Catalog subject rules must carry forward';
  end if;
  if new.rules_snapshot is null then return null; end if;

  owner_id := new.rules_snapshot->>'ownerSubjectId';
  defaults := new.rules_snapshot->'defaults';
  if jsonb_typeof(new.rules_snapshot) is distinct from 'object'
    or not (new.rules_snapshot ? 'ownerSubjectId')
    or jsonb_typeof(new.rules_snapshot->'ownerSubjectId') not in ('null', 'string')
    or (owner_id is not null and (introduced.kind <> 'node-type' or not exists (
      select 1 from catalog_release_subjects owner
      join catalog_drivers driver on driver.subject_id = owner.subject_id
      where owner.release_id = new.release_id and owner.subject_id = owner_id)))
    or (introduced.kind = 'driver' and (
      jsonb_typeof(defaults) is distinct from 'object'
      or coalesce(defaults->>'nature', '') not in ('physical-device', 'logical-service')
      or coalesce(defaults->>'cardinality', '') not in ('multiple', 'singleton-per-project')))
    or (introduced.kind <> 'driver' and defaults is not null) then
    raise exception using errcode = '23514', message = 'Invalid Catalog subject rules snapshot';
  end if;
  if (previous is distinct from new.rules_snapshot or
      (previous_lifecycle is not null and previous_lifecycle is distinct from new.lifecycle)) and
    (new.selector_provenance->>'source' is distinct from 'catalog-subject-rules-correction'
      or new.selector_provenance->>'reviewReference' is distinct from new.release_id) then
    raise exception using errcode = '23514', message = 'Catalog subject rules correction must identify its publication';
  end if;
  return null;
end $$;
alter function parameter_catalog.assert_catalog_subject_release_rules() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_catalog_subject_release_rules() from public;
create constraint trigger catalog_release_subject_rules_ck
  after insert on parameter_catalog.catalog_release_subjects deferrable initially deferred
  for each row execute function parameter_catalog.assert_catalog_subject_release_rules();

-- Reuse the complete materialization and pointer checks with versioned owner scope.
do $migration$
declare definition text; name text;
  old_scope constant text := 'canonical_owner.owner_subject_id is not distinct from alias_subject.owner_subject_id';
  new_scope constant text := '(case when canonical_membership.rules_snapshot is null then canonical_owner.owner_subject_id
        else canonical_membership.rules_snapshot->>''ownerSubjectId'' end) is not distinct from
      (select case when alias_membership.rules_snapshot is null then alias_subject.owner_subject_id
        else alias_membership.rules_snapshot->>''ownerSubjectId'' end
        from parameter_catalog.catalog_release_subjects alias_membership
        where alias_membership.release_id = release_alias.release_id and alias_membership.subject_id = release_alias.subject_id)';
begin
  foreach name in array array['assert_catalog_materialization_projection_complete', 'assert_current_release_complete'] loop
    select pg_get_functiondef(('parameter_catalog.' || name || '()')::regprocedure) into strict definition;
    if position(old_scope in definition) = 0 then
      raise exception 'Catalog selector scope check is missing from %', name;
    end if;
    execute replace(definition, old_scope, new_scope);
  end loop;
end $migration$;

-- App workflows and existing organization overrides resolve the shared owner
-- from the current membership, with a fallback for legacy claim-only rows.
do $migration$
declare definition text; name text;
  owner_sql constant text := '(select case when versioned.rules_snapshot is null then ROOT.owner_subject_id
    else versioned.rules_snapshot->>''ownerSubjectId'' end
    from (select current_catalog_release_id from parameter_catalog.catalog_state) current
    left join parameter_catalog.catalog_release_subjects versioned
      on versioned.release_id=current.current_catalog_release_id and versioned.subject_id=ROOT.id)';
begin
  foreach name in array array[
    'organization_subject_owner_conflicts(text,text,text)',
    'assert_organization_subject_owner()', 'assert_registration_recognition_owner()',
    'assert_subject_placement_kind()'
  ] loop
    select pg_get_functiondef(('parameter_catalog.' || name)::regprocedure) into strict definition;
    definition := replace(definition, 'subject.owner_subject_id', replace(owner_sql, 'ROOT', 'subject'));
    if name = 'assert_organization_subject_owner()' then
      definition := replace(definition, 's.kind,s.owner_subject_id', 's.kind,' || replace(owner_sql, 'ROOT', 's'));
      definition := replace(definition, ' or default_owner is null', '');
      definition := replace(definition, 'if not exists(select 1 from parameter_catalog.organization_subject_registrations owner',
        'if effective_owner is not null and not exists(select 1 from parameter_catalog.organization_subject_registrations owner');
    end if;
    if name = 'organization_subject_owner_conflicts(text,text,text)' then
      definition := replace(definition, 'target.owner_id=p_owner', 'target.owner_id is not distinct from p_owner');
      definition := replace(definition, 'join parameter_catalog.catalog_subject_aliases alias on alias.subject_id=subject.id
      join parameter_catalog.catalog_release_subject_aliases alias_membership on alias_membership.alias_id=alias.id
        and alias_membership.release_id=membership.release_id',
        'join parameter_catalog.catalog_release_subject_aliases alias_membership on alias_membership.subject_id=subject.id
        and alias_membership.release_id=membership.release_id
        join parameter_catalog.catalog_subject_aliases alias on alias.id=alias_membership.alias_id');
    end if;
    execute definition;
  end loop;
  select pg_get_viewdef('parameter_catalog.registration_effective_module'::regclass, true) into strict definition;
  execute 'create or replace view parameter_catalog.registration_effective_module as ' ||
    replace(definition, 'subject.owner_subject_id', replace(owner_sql, 'ROOT', 'subject'));
  select pg_get_functiondef('parameter_catalog.assert_source_managed_scope_receipt()'::regprocedure) into strict definition;
  execute replace(definition, 'identity.owner_subject_id', replace(owner_sql, 'ROOT', 'identity'));
  select pg_get_functiondef('parameter_catalog.claim_catalog_subject_owner(text,text)'::regprocedure) into strict definition;
  if position('if current_owner is not null then' in definition) = 0 then
    raise exception 'Catalog legacy owner claim check is missing';
  end if;
  execute replace(definition, 'if current_owner is not null then',
    'if exists (select 1 from catalog_release_subjects membership
      where membership.subject_id=claim_catalog_subject_owner.subject_id and membership.rules_snapshot is not null) then
      raise exception using errcode=''55000'', message=''Versioned Catalog ownership requires publication'';
    end if;
    if current_owner is not null then');
end $migration$;
