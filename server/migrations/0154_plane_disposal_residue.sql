-- T2.3b: reviewed residue disposal for a captured project parameter plane.
-- Does not rewrite 0148/0149/0151/0152/0153. Does not DROP captured tables.
-- Ordinary DELETE of immutable rows stays fail-closed.

create table if not exists parameter_catalog.plane_disposal_allowlist (
  archive_id text not null,
  relation_from text not null,
  pk text not null,
  txid bigint not null default txid_current(),
  primary key (archive_id, relation_from, pk)
);

create table if not exists parameter_catalog.plane_disposal_runs (
  id text primary key check (id <> '' and btrim(id) = id),
  organization_id text not null references public.organizations(id) on delete restrict,
  project_id text not null,
  archive_id text not null references public.project_parameter_plane_archives(id) on delete restrict,
  archive_digest text not null,
  approval_ref text not null check (approval_ref <> '' and btrim(approval_ref) = approval_ref),
  phase text not null check (phase in (
    'archive-verified',
    'rehomed',
    'residue-deleted',
    'recovery-required'
  )),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists plane_disposal_runs_archive_uk
  on parameter_catalog.plane_disposal_runs (archive_id);

alter table public.dts_reload_run_targets
  alter column binding_id drop not null;
alter table public.dts_reload_run_targets
  add column if not exists disposed_binding_id text;

create or replace function parameter_catalog.plane_disposal_allows_delete(
  p_schema text,
  p_table text,
  p_pk text
) returns boolean
language sql
stable
set search_path = pg_catalog, parameter_catalog
as $$
  select exists (
    select 1
      from parameter_catalog.plane_disposal_allowlist allowlist
     where allowlist.relation_from = p_schema || '.' || p_table
       and allowlist.pk = p_pk
       and allowlist.txid = txid_current()
  );
$$;

create or replace function parameter_catalog.dispose_plane_residue(
  p_archive_id text,
  p_relation_from text,
  p_pk_column text,
  p_pks text[]
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog, public
as $$
declare
  deleted integer := 0;
  allowed constant text[] := array[
    'public.parameter_drafts',
    'public.project_parameter_values',
    'public.parameter_draft_identity_invalidations',
    'public.parameter_history_entries',
    'public.parameter_submission_rounds',
    'public.parameter_change_requests',
    'public.project_parameter_bindings',
    'public.project_parameter_files',
    'public.project_parameter_file_candidates',
    'public.project_parameter_initialization_drafts',
    'public.project_parameter_initialization_reviews',
    'public.parameter_import_batches',
    'public.parameter_file_sync_conflicts',
    'public.identity_mapping_tasks',
    'public.parameter_spec_matcher_overrides',
    'public.dts_property_occurrence_spec_decisions',
    'public.project_parameter_value_drafts',
    'public.project_parameter_value_change_requests',
    'public.parameter_review_decisions',
    'public.parameter_submission_items',
    'public.project_parameter_binding_revisions',
    'public.project_parameter_file_versions',
    'public.dts_config_set',
    'public.dts_release_baseline',
    'public.dts_release_baseline_members',
    'public.dts_config_revisions',
    'public.dts_config_revision_members',
    'public.dts_logical_nodes',
    'public.dts_logical_node_revisions',
    'public.dts_node_occurrences',
    'public.dts_property_occurrences',
    'public.dts_occurrence_effects',
    'public.dts_nodes',
    'public.dts_properties',
    'public.dts_phandle_refs',
    'public.dts_validation_runs',
    'public.dts_validation_diagnostics',
    'parameter_catalog.project_parameter_bindings',
    'parameter_catalog.project_parameter_source_occurrences',
    'parameter_catalog.project_value_source_pins',
    'parameter_catalog.binding_history_events',
    'parameter_catalog.project_parameter_values'
  ];
begin
  if p_relation_from is null or not (p_relation_from = any (allowed)) then
    raise exception using errcode = '22023', message = 'plane disposal relation is not in the closed list';
  end if;
  if p_pk_column is null or p_pk_column not in ('id', 'draft_id') then
    raise exception using errcode = '22023', message = 'plane disposal pk column is not allowed';
  end if;
  if p_pks is null or cardinality(p_pks) = 0 then
    return 0;
  end if;
  insert into parameter_catalog.plane_disposal_allowlist (archive_id, relation_from, pk)
  select p_archive_id, p_relation_from, pk
    from unnest(p_pks) as pk
  on conflict do nothing;
  execute format(
    'delete from %s where %I = any($1)',
    p_relation_from,
    p_pk_column
  ) using p_pks;
  get diagnostics deleted = row_count;
  delete from parameter_catalog.plane_disposal_allowlist
   where archive_id = p_archive_id
     and relation_from = p_relation_from;
  return deleted;
end;
$$;

revoke all on table parameter_catalog.plane_disposal_allowlist from public;
revoke all on table parameter_catalog.plane_disposal_runs from public;
grant select, insert, update, delete on table parameter_catalog.plane_disposal_allowlist to catalog_migration_owner;
grant select, insert, update, delete on table parameter_catalog.plane_disposal_runs to catalog_migration_owner;
alter table parameter_catalog.plane_disposal_allowlist owner to catalog_migration_owner;
alter table parameter_catalog.plane_disposal_runs owner to catalog_migration_owner;
alter function parameter_catalog.plane_disposal_allows_delete(text, text, text) owner to catalog_migration_owner;
alter function parameter_catalog.dispose_plane_residue(text, text, text, text[]) owner to catalog_migration_owner;
revoke all on function parameter_catalog.plane_disposal_allows_delete(text, text, text) from public;
grant execute on function parameter_catalog.plane_disposal_allows_delete(text, text, text) to public;
grant execute on function parameter_catalog.dispose_plane_residue(text, text, text, text[]) to public;
do $$
begin
  execute format('grant usage on schema parameter_catalog to %I', current_user);
  execute format(
    'grant select, insert, update on table parameter_catalog.plane_disposal_runs to %I',
    current_user
  );
end;
$$;

grant delete on
  public.parameter_drafts,
  public.project_parameter_values,
  public.parameter_draft_identity_invalidations,
  public.parameter_history_entries,
  public.parameter_submission_rounds,
  public.parameter_change_requests,
  public.project_parameter_bindings,
  public.project_parameter_files,
  public.project_parameter_file_candidates,
  public.project_parameter_initialization_drafts,
  public.project_parameter_initialization_reviews,
  public.parameter_import_batches,
  public.parameter_file_sync_conflicts,
  public.identity_mapping_tasks,
  public.parameter_spec_matcher_overrides,
  public.dts_property_occurrence_spec_decisions,
  public.project_parameter_value_drafts,
  public.project_parameter_value_change_requests,
  public.parameter_review_decisions,
  public.parameter_submission_items,
  public.project_parameter_binding_revisions,
  public.project_parameter_file_versions,
  public.dts_config_set,
  public.dts_release_baseline,
  public.dts_release_baseline_members,
  public.dts_config_revisions,
  public.dts_config_revision_members,
  public.dts_logical_nodes,
  public.dts_logical_node_revisions,
  public.dts_node_occurrences,
  public.dts_property_occurrences,
  public.dts_occurrence_effects,
  public.dts_nodes,
  public.dts_properties,
  public.dts_phandle_refs,
  public.dts_validation_runs,
  public.dts_validation_diagnostics
to catalog_migration_owner;

grant delete on
  parameter_catalog.project_parameter_bindings,
  parameter_catalog.project_parameter_source_occurrences,
  parameter_catalog.project_value_source_pins,
  parameter_catalog.binding_history_events,
  parameter_catalog.project_parameter_values
to catalog_migration_owner;

grant update (binding_id, disposed_binding_id) on public.dts_reload_run_targets to catalog_migration_owner;

create or replace function parameter_catalog.protect_binding_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
      return old;
    end if;
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

create or replace function parameter_catalog.reject_immutable_catalog_change()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE'
     and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
end;
$$;

create or replace function parameter_catalog.protect_source_occurrence_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
      return old;
    end if;
    raise exception using errcode = '55000', message = 'Source occurrence identity is immutable';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.config_set_id is distinct from old.config_set_id
     or new.file_id is distinct from old.file_id
     or new.occurrence_kind is distinct from old.occurrence_kind
     or new.logical_node_id is distinct from old.logical_node_id
     or new.configuration_instance_id is distinct from old.configuration_instance_id
     or new.configuration_schema_subject_id is distinct from old.configuration_schema_subject_id
     or new.root_pointer is distinct from old.root_pointer then
    raise exception using errcode = '55000', message = 'Source occurrence identity is immutable';
  end if;
  return new;
end;
$$;

create or replace function parameter_catalog.reject_immutable_project_value_source_pin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE'
     and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'ProjectValue source pins are immutable';
end;
$$;

create or replace function parameter_catalog.protect_project_parameter_binding_source_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
      return old;
    end if;
    raise exception using errcode = '55000', message = 'Binding source occurrence identity is immutable';
  end if;
  if old.source_occurrence_id is not null
     and new.source_occurrence_id is distinct from old.source_occurrence_id then
    raise exception using errcode = '55000', message = 'Binding source occurrence identity is immutable';
  end if;
  return new;
end;
$$;

create or replace function parameter_catalog.protect_submitted_source_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
      return old;
    end if;
    raise exception using errcode = '55000', message = 'Submitted source request identity is immutable';
  end if;
  if old.status = 'approved'
     and (
       new.status is distinct from old.status
       or new.applied_value_id is distinct from old.applied_value_id
       or new.apply_outcome is distinct from old.apply_outcome
       or new.applied_at is distinct from old.applied_at
       or new.applied_history_event_id is distinct from old.applied_history_event_id
       or new.applied_audit_ref is distinct from old.applied_audit_ref
       or new.applied_file_version_ids is distinct from old.applied_file_version_ids
       or new.applied_source_result is distinct from old.applied_source_result
     ) then
    raise exception using errcode = '55000', message = 'Applied source request result is immutable';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or (
       new.draft_id is distinct from old.draft_id
       and not (old.draft_id is not null and new.draft_id is null)
     )
     or new.binding_id is distinct from old.binding_id
     or new.definition_id is distinct from old.definition_id
     or new.definition_revision_id is distinct from old.definition_revision_id
     or new.catalog_release_id is distinct from old.catalog_release_id
     or new.base_current_value_id is distinct from old.base_current_value_id
     or new.config_revision_id is distinct from old.config_revision_id
     or new.source_ref is distinct from old.source_ref
     or new.action is distinct from old.action
     or new.target_value is distinct from old.target_value
     or new.reason is distinct from old.reason
     or new.source_pin_id is distinct from old.source_pin_id
     or new.candidate_id is distinct from old.candidate_id
     or new.candidate_base_digest is distinct from old.candidate_base_digest
     or new.candidate_proposed_digest is distinct from old.candidate_proposed_digest
     or new.candidate_diff_digest is distinct from old.candidate_diff_digest
     or new.candidate_member_manifest is distinct from old.candidate_member_manifest
     or new.candidate_binding_manifest is distinct from old.candidate_binding_manifest then
    raise exception using errcode = '55000', message = 'Submitted source request identity is immutable';
  end if;
  return new;
end;
$$;

create or replace function parameter_catalog.protect_pinned_source_provenance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  old_revision text;
  new_revision text;
  revision_ids text[];
begin
  if tg_op = 'DELETE'
     and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    if tg_table_name = 'dts_config_revisions' then old_revision := old.id;
    else old_revision := old.config_revision_id; end if;
  end if;
  if tg_op <> 'DELETE' then
    if tg_table_name = 'dts_config_revisions' then new_revision := new.id;
    else new_revision := new.config_revision_id; end if;
  end if;
  revision_ids := array[old_revision, new_revision];
  perform id from public.dts_config_revisions
    where id = any(revision_ids) order by id for update nowait;
  if tg_table_name = 'dts_config_revisions' and tg_op = 'UPDATE'
     and new is not distinct from old then return new; end if;
  if exists (select 1 from parameter_catalog.project_value_source_pins
             where config_revision_id = any(revision_ids)) then
    raise exception using errcode = '55000', message = 'Pinned source graph is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function parameter_catalog.protect_pinned_source_file()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  identity_ids text[];
  revision_ids text[];
  members_before jsonb;
  members_after jsonb;
begin
  if tg_op = 'DELETE'
     and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  identity_ids := array[old.id];
  if tg_op = 'UPDATE' then identity_ids := array_append(identity_ids, new.id); end if;
  select coalesce(jsonb_agg(jsonb_build_array(id, config_revision_id, file_id, file_version_id)
                            order by id), '[]'::jsonb),
         array_agg(distinct config_revision_id order by config_revision_id)
    into members_before, revision_ids
    from public.dts_config_revision_members
    where (tg_table_name = 'project_parameter_files' and file_id = any(identity_ids))
       or (tg_table_name = 'project_parameter_file_versions' and file_version_id = any(identity_ids));
  perform id from public.dts_config_revisions
    where id = any(revision_ids) order by id for update nowait;
  select coalesce(jsonb_agg(jsonb_build_array(id, config_revision_id, file_id, file_version_id)
                            order by id), '[]'::jsonb)
    into members_after from public.dts_config_revision_members
    where (tg_table_name = 'project_parameter_files' and file_id = any(identity_ids))
       or (tg_table_name = 'project_parameter_file_versions' and file_version_id = any(identity_ids));
  if members_after is distinct from members_before then
    raise exception using errcode = '40001', message = 'Source membership changed; retry the whole transaction';
  end if;
  if exists (select 1 from parameter_catalog.project_value_source_pins
             where config_revision_id = any(revision_ids)) then
    if tg_table_name = 'project_parameter_files' and tg_op = 'UPDATE'
       and (to_jsonb(new) - array['file_name','current_version_id','updated_at'])
           is not distinct from (to_jsonb(old) - array['file_name','current_version_id','updated_at']) then
      return new;
    end if;
    raise exception using errcode = '55000', message = 'Pinned source file identity and version are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
