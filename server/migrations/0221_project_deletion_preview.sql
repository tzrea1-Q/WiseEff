-- Project deletion impact: counts and state evidence only, no private row bodies.
grant select(id, organization_id, is_active) on public.users to catalog_migration_owner;
grant select(user_id, organization_id, project_id, role_id) on public.user_role_bindings to catalog_migration_owner;
grant select(id, organization_id) on public.projects to catalog_migration_owner;
create function parameter_catalog.preview_project_deletion_catalog(
  p_organization_id text, p_project_id text, p_principal_id text
) returns table(key text, item_count bigint, state_digest text)
language plpgsql stable security definer
set search_path = pg_catalog, parameter_catalog, public
as $$
begin
  if not exists(select 1 from public.users u join public.user_role_bindings r
      on r.user_id=u.id and r.organization_id=u.organization_id
      where u.id=p_principal_id and u.organization_id=p_organization_id and u.is_active
        and r.project_id is null and r.role_id in ('admin','platform-admin')) then
    raise exception using errcode='42501', message='Organization administrator is required for project deletion preview';
  end if;
  if not exists(select 1 from public.projects p where p.id=p_project_id and p.organization_id=p_organization_id) then
    return;
  end if;
  return query select 'canonical-bindings'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.project_parameter_bindings where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'canonical-values'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.project_parameter_values where binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=p_organization_id and project_id=p_project_id)) r) scoped;

  return query select 'canonical-history'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.binding_history_events where binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=p_organization_id and project_id=p_project_id)) r) scoped;

  return query select 'source-occurrences'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.project_parameter_source_occurrences where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'source-pins'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.project_value_source_pins where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'member-tombstones'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.project_source_member_tombstones where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'observations'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.parameter_observations where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'observation-matches'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.parameter_observation_matches where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'review-evidence'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.parameter_review_evidence where organization_id=p_organization_id and observation_id in (select id from parameter_catalog.parameter_observations where organization_id=p_organization_id and project_id=p_project_id)) r) scoped;

  return query select 'identity-replacements'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.definition_replacement_projects where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'shared-definitions'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select distinct d.* from parameter_catalog.parameter_definitions d join parameter_catalog.project_parameter_bindings b on b.definition_id=d.id where b.organization_id=p_organization_id and b.project_id=p_project_id) r) scoped;

  return query select 'plane-disposal'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.plane_disposal_runs where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'active-definition-migration'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.definition_replacement_projects where organization_id=p_organization_id and project_id=p_project_id and status<>'completed') r) scoped;

  return query select 'canonical-external-replacements'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select v.* from parameter_catalog.project_parameter_values v where v.binding_id not in (select id from parameter_catalog.project_parameter_bindings where organization_id=p_organization_id and project_id=p_project_id) and v.replaced_from_value_id in (select v2.id from parameter_catalog.project_parameter_values v2 join parameter_catalog.project_parameter_bindings b on b.id=v2.binding_id where b.organization_id=p_organization_id and b.project_id=p_project_id)) r) scoped;
end;
$$;
alter function parameter_catalog.preview_project_deletion_catalog(text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.preview_project_deletion_catalog(text,text,text) from public;
grant execute on function parameter_catalog.preview_project_deletion_catalog(text,text,text) to catalog_baseline_reader_role;
