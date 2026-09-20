-- #849/#853 T1.1: source occurrence identity and immutable source pins.
--
-- This migration is deliberately additive.  It preserves Binding, ProjectValue,
-- observation, match, history, candidate, draft and request identifiers.  The
-- migration runner wraps this file in one transaction; the writer fence and all
-- provenance checks below therefore roll back the complete expansion on any
-- unprovable row.

select pg_catalog.pg_advisory_xact_lock(8490151001);

-- Block every known canonical writer before the first provenance read.  Keep this
-- order stable: config sets, files/versions, revisions/members, DTS facts,
-- canonical rows, pending workflow rows, then replacement projections.
lock table
  public.dts_config_set,
  public.project_parameter_files,
  public.project_parameter_file_versions,
  public.dts_config_revisions,
  public.dts_config_revision_members,
  public.dts_node_occurrences,
  public.dts_property_occurrences,
  public.dts_logical_nodes,
  public.dts_logical_node_revisions,
  public.dts_occurrence_effects,
  parameter_catalog.project_parameter_bindings,
  parameter_catalog.project_parameter_values,
  parameter_catalog.parameter_observations,
  parameter_catalog.parameter_observation_matches,
  public.project_parameter_value_drafts,
  public.project_parameter_value_change_requests,
  parameter_catalog.definition_replacement_projects
in share row exclusive mode;

-- The table fence blocks canonical writers; retain deterministic tuple locks for
-- the complete R1 history graph while discovery, proof and backfill run.  Keep
-- the table and key order aligned with the fence so two migration-shaped
-- transactions cannot acquire overlapping rows in opposite orders.
select id
from public.dts_config_set
order by id, organization_id, project_id
for update;
select id
from public.project_parameter_files
order by id, organization_id, project_id
for update;
select id
from public.project_parameter_file_versions
order by id, file_id
for update;
select id
from public.dts_config_revisions
order by id, organization_id, project_id, config_set_id
for update;
select id
from public.dts_config_revision_members
order by id, config_revision_id, file_id, file_version_id
for update;
select id
from public.dts_node_occurrences
order by id, config_revision_id, file_version_id
for update;
select id
from public.dts_property_occurrences
order by id, config_revision_id, node_occurrence_id, file_version_id
for update;
select id
from public.dts_logical_nodes
order by id, organization_id, project_id, config_set_id
for update;
select id
from public.dts_logical_node_revisions
order by id, logical_node_id, config_revision_id
for update;
select id
from public.dts_occurrence_effects
order by id, config_revision_id, logical_node_revision_id,
  node_occurrence_id, property_occurrence_id
for update;
select id
from parameter_catalog.project_parameter_bindings
order by id, organization_id, project_id
for update;
select id
from parameter_catalog.project_parameter_values
order by id, binding_id, definition_id
for update;
select id
from parameter_catalog.parameter_observations
order by id, organization_id, project_id
for update;
select id
from parameter_catalog.parameter_observation_matches
order by id, organization_id, project_id
for update;
select id
from public.project_parameter_value_drafts
order by id, organization_id, project_id
for update;
select id
from public.project_parameter_value_change_requests
order by id, organization_id, project_id
for update;
select id
from parameter_catalog.definition_replacement_projects
order by id, organization_id, project_id
for update;

-- Tenant-complete candidate keys for the source graph.  Unique indexes are used
-- instead of new mutable identity columns, so old primary keys remain unchanged.
create unique index if not exists dts_config_set_id_owner_uk
  on public.dts_config_set (id, organization_id, project_id);
create unique index if not exists project_parameter_files_id_owner_uk
  on public.project_parameter_files (id, organization_id, project_id);
create unique index if not exists project_parameter_files_id_owner_config_set_uk
  on public.project_parameter_files (id, organization_id, project_id, config_set_id);
create unique index if not exists project_parameter_file_versions_file_id_uk
  on public.project_parameter_file_versions (file_id, id);
alter table public.project_parameter_files
  add constraint project_parameter_files_current_version_owner_fk
  foreign key (id, current_version_id)
  references public.project_parameter_file_versions(file_id, id)
  on delete restrict;
create unique index if not exists dts_config_revisions_id_owner_uk
  on public.dts_config_revisions (id, organization_id, project_id, config_set_id);
create unique index if not exists dts_config_revision_members_identity_uk
  on public.dts_config_revision_members (id, config_revision_id, file_id, file_version_id);
create unique index if not exists dts_config_revision_members_revision_file_version_uk
  on public.dts_config_revision_members (config_revision_id, file_id, file_version_id);

-- A revision member's parser/export alias is distinct from the mutable file
-- display name and immutable file identity.  Keep the expansion nullable for
-- unpinned legacy history; the provenance backfill below fills every member of
-- a revision that is actually pinned, or aborts the complete transaction.
alter table public.dts_config_revision_members
  add column if not exists source_name text;

create or replace function parameter_catalog.normalize_dts_source_name(raw text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  trimmed text;
  part text;
  parts text[];
  normalized_parts text[] := array[]::text[];
  part_count integer;
begin
  trimmed := btrim(raw);
  if trimmed = '' or right(trimmed, 1) = '/' or trimmed ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '23514',
      message = 'DTS revision member source_name must be a safe relative path';
  end if;
  if left(trimmed, 1) = '/' then
    raise exception using
      errcode = '23514',
      message = 'DTS revision member source_name must not be absolute';
  end if;

  parts := regexp_split_to_array(trimmed, '/');
  foreach part in array parts loop
    if part = '' or part = '.' then
      continue;
    elsif part = '..' then
      part_count := coalesce(cardinality(normalized_parts), 0);
      if part_count = 0 then
        raise exception using
          errcode = '23514',
          message = 'DTS revision member source_name escapes its workspace';
      end if;
      normalized_parts := normalized_parts[1:part_count - 1];
    else
      normalized_parts := array_append(normalized_parts, part);
    end if;
  end loop;

  if coalesce(cardinality(normalized_parts), 0) = 0 then
    raise exception using
      errcode = '23514',
      message = 'DTS revision member source_name must not be empty';
  end if;
  return array_to_string(normalized_parts, '/');
end;
$$;

create or replace function parameter_catalog.normalize_dts_revision_member_source_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if new.source_name is not null then
    new.source_name := parameter_catalog.normalize_dts_source_name(new.source_name);
  end if;
  return new;
end;
$$;

create trigger dts_config_revision_member_source_name_normalized
before insert or update of source_name on public.dts_config_revision_members
for each row execute function parameter_catalog.normalize_dts_revision_member_source_name();

alter table public.dts_config_revision_members
  add constraint dts_config_revision_member_source_name_ck check (
    source_name is null
    or (
      source_name <> ''
      and btrim(source_name) = source_name
      and source_name <> '.'
      and source_name !~ '[[:cntrl:]]'
      and source_name !~ '^/'
      and source_name !~ '(^|/)\.(/|$)'
      and source_name !~ '(^|/)\.\.(/|$)'
      and source_name !~ '//'
      and source_name !~ '/$'
    )
  );
create unique index if not exists dts_config_revision_members_source_name_uk
  on public.dts_config_revision_members (config_revision_id, source_name)
  where source_name is not null;

create unique index if not exists dts_logical_nodes_id_owner_uk
  on public.dts_logical_nodes (id, organization_id, project_id, config_set_id);
create unique index if not exists project_parameter_bindings_id_owner_project_uk
  on parameter_catalog.project_parameter_bindings (id, organization_id, project_id);
create unique index if not exists project_parameter_values_identity_uk
  on parameter_catalog.project_parameter_values (id, binding_id, definition_id);

create table if not exists parameter_catalog.project_parameter_source_occurrences (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  project_id text not null,
  config_set_id text not null,
  file_id text not null,
  occurrence_kind text not null check (occurrence_kind in ('dts', 'json')),
  logical_node_id text,
  configuration_instance_id text,
  configuration_schema_subject_id text,
  root_pointer text,
  root_pointer_digest text,
  created_at timestamptz not null default now(),
  unique (id, organization_id, project_id),
  constraint source_occurrence_project_owner_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint source_occurrence_config_set_owner_fk
    foreign key (config_set_id, organization_id, project_id)
    references public.dts_config_set(id, organization_id, project_id) on delete restrict,
  constraint source_occurrence_file_owner_fk
    foreign key (file_id, organization_id, project_id, config_set_id)
    references public.project_parameter_files(id, organization_id, project_id, config_set_id)
    on delete restrict,
  constraint source_occurrence_dts_node_owner_fk
    foreign key (logical_node_id, organization_id, project_id, config_set_id)
    references public.dts_logical_nodes(id, organization_id, project_id, config_set_id)
    on delete restrict,
  constraint source_occurrence_configuration_schema_fk
    foreign key (configuration_schema_subject_id)
    references parameter_catalog.catalog_configuration_schemas(subject_id)
    on delete restrict,
  constraint source_occurrence_kind_columns_ck check (
    (occurrence_kind = 'dts'
      and logical_node_id is not null
      and configuration_instance_id is null
      and configuration_schema_subject_id is null
      and root_pointer is null
      and root_pointer_digest is null)
    or
    (occurrence_kind = 'json'
      and logical_node_id is null
      and configuration_instance_id is not null
      and configuration_schema_subject_id is not null
      and root_pointer is not null
      and root_pointer_digest is not null
      and (root_pointer = '' or root_pointer ~ '^(/([^~/]|~0|~1)*)+$'))
  )
);

create unique index if not exists source_occurrence_dts_natural_uk
  on parameter_catalog.project_parameter_source_occurrences (
    organization_id, project_id, config_set_id, file_id, logical_node_id
  ) where occurrence_kind = 'dts';
create unique index if not exists source_occurrence_json_natural_uk
  on parameter_catalog.project_parameter_source_occurrences (
    organization_id, project_id, config_set_id, file_id,
    configuration_schema_subject_id, root_pointer
  ) where occurrence_kind = 'json';
create unique index if not exists source_occurrence_json_instance_uk
  on parameter_catalog.project_parameter_source_occurrences (configuration_instance_id)
  where occurrence_kind = 'json';

-- The application serializer is deliberately reproduced here rather than
-- hashing jsonb::text (whose object order is not the contract).  Keep this
-- fixed-shape five-string serializer byte-for-byte aligned with
-- parameter-catalog-contract.serializeContract: ASCII key order, two spaces,
-- LF separators and a final LF.  Callers validate the exact locator shape
-- before invoking it.
create or replace function parameter_catalog.canonical_dts_parameter_locator_digest(locator jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
as $$
  select 'sha256:' || encode(
    pg_catalog.sha256(convert_to(
      concat(
        '{', chr(10),
        '  "fileVersionId": ', to_json(locator ->> 'fileVersionId')::text, ',', chr(10),
        '  "kind": ', to_json(locator ->> 'kind')::text, ',', chr(10),
        '  "nodeOccurrenceId": ', to_json(locator ->> 'nodeOccurrenceId')::text, ',', chr(10),
        '  "propertyName": ', to_json(locator ->> 'propertyName')::text, ',', chr(10),
        '  "propertyOccurrenceId": ', to_json(locator ->> 'propertyOccurrenceId')::text, chr(10),
        '}', chr(10)
      ),
      'UTF8'
    )),
    'hex'
  )
$$;

alter table parameter_catalog.project_parameter_bindings
  add column if not exists source_occurrence_id text;
alter table parameter_catalog.project_parameter_bindings
  alter column logical_node_id drop not null;
alter table parameter_catalog.project_parameter_bindings
  add constraint project_parameter_binding_source_occurrence_fk
  foreign key (source_occurrence_id, organization_id, project_id)
  references parameter_catalog.project_parameter_source_occurrences(id, organization_id, project_id)
  on delete restrict
  deferrable initially deferred;
create unique index if not exists project_parameter_bindings_source_match_uk
  on parameter_catalog.project_parameter_bindings (
    id, organization_id, project_id, source_occurrence_id,
    registration_id, subject_id, definition_id
  );

create table if not exists parameter_catalog.project_value_source_pins (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  project_value_id text not null,
  binding_id text not null,
  definition_id text not null,
  organization_id text not null,
  project_id text not null,
  source_occurrence_id text not null,
  config_revision_id text not null,
  file_id text not null,
  file_version_id text not null,
  format text not null check (format in ('dts', 'json')),
  property_occurrence_id text,
  locator jsonb not null check (jsonb_typeof(locator) = 'object'),
  locator_digest text not null check (locator_digest <> '' and btrim(locator_digest) = locator_digest),
  created_at timestamptz not null default now(),
  unique (project_value_id),
  unique (id, organization_id, project_id, binding_id),
  constraint project_value_source_pin_value_fk
    foreign key (project_value_id, binding_id, definition_id)
    references parameter_catalog.project_parameter_values(id, binding_id, definition_id)
    on delete restrict,
  constraint project_value_source_pin_binding_fk
    foreign key (binding_id, organization_id, project_id)
    references parameter_catalog.project_parameter_bindings(id, organization_id, project_id)
    on delete restrict,
  constraint project_value_source_pin_occurrence_fk
    foreign key (source_occurrence_id, organization_id, project_id)
    references parameter_catalog.project_parameter_source_occurrences(id, organization_id, project_id)
    on delete restrict,
  constraint project_value_source_pin_revision_fk
    foreign key (config_revision_id)
    references public.dts_config_revisions(id) on delete restrict,
  constraint project_value_source_pin_revision_member_fk
    foreign key (config_revision_id, file_id, file_version_id)
    references public.dts_config_revision_members(config_revision_id, file_id, file_version_id)
    on delete restrict,
  constraint project_value_source_pin_file_version_fk
    foreign key (file_id, file_version_id)
    references public.project_parameter_file_versions(file_id, id) on delete restrict,
  constraint project_value_source_pin_property_fk
    foreign key (property_occurrence_id)
    references public.dts_property_occurrences(id) on delete restrict,
  constraint project_value_source_pin_locator_ck check (
    (format = 'dts'
      and property_occurrence_id is not null
      and locator->>'kind' = 'dts-property'
      and locator = jsonb_build_object(
        'kind', 'dts-property',
        'propertyOccurrenceId', locator->>'propertyOccurrenceId',
        'nodeOccurrenceId', locator->>'nodeOccurrenceId',
        'fileVersionId', locator->>'fileVersionId',
        'propertyName', locator->>'propertyName'
      )
      and btrim(coalesce(locator->>'propertyOccurrenceId', '')) <> ''
      and btrim(coalesce(locator->>'nodeOccurrenceId', '')) <> ''
      and btrim(coalesce(locator->>'fileVersionId', '')) <> ''
      and btrim(coalesce(locator->>'propertyName', '')) <> '')
    or
    (format = 'json'
      and property_occurrence_id is null
      and locator->>'kind' = 'json-pointer'
      and locator = jsonb_build_object(
        'kind', 'json-pointer',
        'pointer', locator->>'pointer'
      )
      and locator->>'pointer' is not null
      and (locator->>'pointer' = '' or locator->>'pointer' ~ '^(/([^~/]|~0|~1)*)+$'))
  )
);

-- A pin is historical evidence, so its referenced revision/member/provenance
-- rows cannot be rewritten after the pin is committed.  The trigger is
-- intentionally conditional: unpinned topology remains editable while a
-- pinned source's exact owner and locator stay stable.
create or replace function parameter_catalog.protect_pinned_source_provenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  pinned boolean := false;
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'dts_config_revision_members'
       and new.source_name is null
       and exists (
         select 1
         from parameter_catalog.project_value_source_pins pin
         where pin.config_revision_id = new.config_revision_id
       ) then
      raise exception using
        errcode = '23514',
        message = 'Pinned DTS revision members require an immutable source_name';
    end if;
    return new;
  end if;
  if tg_op not in ('UPDATE', 'DELETE') then
    return new;
  end if;
  if tg_table_name = 'dts_config_revisions' then
    select exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      where pin.config_revision_id = old.id
    ) into pinned;
  elsif tg_table_name = 'dts_config_revision_members' then
    select exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      where pin.config_revision_id = old.config_revision_id
        and pin.file_id = old.file_id
        and pin.file_version_id = old.file_version_id
    ) into pinned;
  elsif tg_table_name = 'dts_logical_node_revisions' then
    select exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id = pin.source_occurrence_id
      where pin.config_revision_id = old.config_revision_id
        and occurrence.logical_node_id = old.logical_node_id
    ) into pinned;
  elsif tg_table_name = 'dts_node_occurrences' then
    select exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      join public.dts_property_occurrences property
        on property.id = pin.property_occurrence_id
      where property.node_occurrence_id = old.id
    ) into pinned;
  elsif tg_table_name = 'dts_property_occurrences' then
    select exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      where pin.property_occurrence_id = old.id
    ) into pinned;
  elsif tg_table_name = 'dts_occurrence_effects' then
    select exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      where pin.property_occurrence_id = old.property_occurrence_id
        and pin.config_revision_id = old.config_revision_id
    ) into pinned;
  end if;
  if pinned then
    raise exception using
      errcode = '55000',
      message = format('Pinned source provenance row %s in %s is immutable', old.id, tg_table_name);
  end if;
  return new;
end;
$$;

create trigger dts_config_revisions_pinned_provenance_immutable
before update or delete on public.dts_config_revisions
for each row execute function parameter_catalog.protect_pinned_source_provenance();
create trigger dts_config_revision_members_pinned_provenance_immutable
before insert or update or delete on public.dts_config_revision_members
for each row execute function parameter_catalog.protect_pinned_source_provenance();
create trigger dts_logical_node_revisions_pinned_provenance_immutable
before update or delete on public.dts_logical_node_revisions
for each row execute function parameter_catalog.protect_pinned_source_provenance();
create trigger dts_node_occurrences_pinned_provenance_immutable
before update or delete on public.dts_node_occurrences
for each row execute function parameter_catalog.protect_pinned_source_provenance();
create trigger dts_property_occurrences_pinned_provenance_immutable
before update or delete on public.dts_property_occurrences
for each row execute function parameter_catalog.protect_pinned_source_provenance();
create trigger dts_occurrence_effects_pinned_provenance_immutable
before update or delete on public.dts_occurrence_effects
for each row execute function parameter_catalog.protect_pinned_source_provenance();

alter table public.project_parameter_value_drafts
  add column if not exists source_pin_id text,
  add column if not exists candidate_id text,
  add column if not exists candidate_base_digest text,
  add column if not exists candidate_proposed_digest text,
  add column if not exists candidate_diff_digest text,
  add column if not exists candidate_member_manifest jsonb,
  add column if not exists candidate_binding_manifest jsonb;
alter table public.project_parameter_value_change_requests
  add column if not exists source_pin_id text,
  add column if not exists candidate_id text,
  add column if not exists candidate_base_digest text,
  add column if not exists candidate_proposed_digest text,
  add column if not exists candidate_diff_digest text,
  add column if not exists candidate_member_manifest jsonb,
  add column if not exists candidate_binding_manifest jsonb,
  add column if not exists applied_history_event_id text,
  add column if not exists applied_audit_ref text,
  add column if not exists applied_file_version_ids jsonb,
  add column if not exists applied_source_result jsonb;

create unique index if not exists project_parameter_file_candidates_id_owner_uk
  on public.project_parameter_file_candidates (id, organization_id, project_id);
create unique index if not exists project_value_source_pins_id_owner_binding_uk
  on parameter_catalog.project_value_source_pins (id, organization_id, project_id, binding_id);

-- Replace the old single-column candidate file FK with an owner-complete,
-- non-cascading reference.  Candidate deletion cannot erase a pinned source.
do $$
declare
  candidate_fk record;
begin
  for candidate_fk in
    select usage.constraint_name
    from information_schema.constraint_column_usage usage
    join information_schema.table_constraints constraint_info
      on constraint_info.constraint_name = usage.constraint_name
     and constraint_info.constraint_schema = usage.constraint_schema
    where usage.constraint_schema = 'public'
      and usage.table_name = 'project_parameter_files'
      and constraint_info.table_name = 'project_parameter_file_candidates'
      and constraint_info.constraint_type = 'FOREIGN KEY'
  loop
    execute format(
      'alter table public.project_parameter_file_candidates drop constraint %I',
      candidate_fk.constraint_name
    );
  end loop;
end;
$$;

alter table public.project_parameter_file_candidates
  add constraint project_parameter_file_candidates_file_owner_fk
  foreign key (file_id, organization_id, project_id)
  references public.project_parameter_files(id, organization_id, project_id)
  on delete restrict;

alter table public.project_parameter_value_drafts
  add constraint project_parameter_value_drafts_source_pin_fk
  foreign key (source_pin_id, organization_id, project_id, binding_id)
  references parameter_catalog.project_value_source_pins(id, organization_id, project_id, binding_id)
  on delete restrict
  deferrable initially deferred;
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_source_pin_fk
  foreign key (source_pin_id, organization_id, project_id, binding_id)
  references parameter_catalog.project_value_source_pins(id, organization_id, project_id, binding_id)
  on delete restrict
  deferrable initially deferred;
alter table public.project_parameter_value_drafts
  add constraint project_parameter_value_drafts_candidate_fk
  foreign key (candidate_id, organization_id, project_id)
  references public.project_parameter_file_candidates(id, organization_id, project_id)
  on delete restrict
  deferrable initially deferred;
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_candidate_fk
  foreign key (candidate_id, organization_id, project_id)
  references public.project_parameter_file_candidates(id, organization_id, project_id)
  on delete restrict
  deferrable initially deferred;

alter table parameter_catalog.parameter_observations
  add column if not exists source_occurrence_id text,
  add column if not exists parameter_locator_digest text;
alter table parameter_catalog.parameter_observations
  alter column logical_node_id drop not null;
alter table parameter_catalog.parameter_observation_matches
  add column if not exists source_occurrence_id text,
  add column if not exists parameter_locator_digest text;
alter table parameter_catalog.parameter_observation_matches
  alter column logical_node_id drop not null;

-- source_identity is an evidence/idempotency label, not source ownership.  The
-- old unique key would incorrectly collapse two parameter locators in one root.
alter table parameter_catalog.parameter_observations
  drop constraint if exists parameter_observations_organization_id_source_identity_key;
alter table parameter_catalog.parameter_observations
  add constraint parameter_observations_locator_digest_ck
  check (parameter_locator_digest is null or parameter_locator_digest ~ '^sha256:[0-9a-f]{64}$');
alter table parameter_catalog.parameter_observation_matches
  add constraint parameter_observation_matches_locator_digest_ck
  check (parameter_locator_digest is null or parameter_locator_digest ~ '^sha256:[0-9a-f]{64}$');

create unique index if not exists parameter_observation_occurrence_key_uk
  on parameter_catalog.parameter_observations (
    id, organization_id, catalog_release_id, matcher_revision,
    project_id, source_occurrence_id, parameter_locator_digest
  );
create unique index if not exists parameter_observation_match_binding_occurrence_uk
  on parameter_catalog.project_parameter_bindings (
    id, organization_id, project_id, source_occurrence_id,
    registration_id, subject_id, definition_id
  );
alter table parameter_catalog.parameter_observations
  add constraint parameter_observation_source_occurrence_fk
  foreign key (source_occurrence_id, organization_id, project_id)
  references parameter_catalog.project_parameter_source_occurrences(id, organization_id, project_id)
  on delete restrict
  deferrable initially deferred;
alter table parameter_catalog.parameter_observation_matches
  add constraint parameter_observation_match_source_occurrence_fk
  foreign key (
    observation_id, organization_id, catalog_release_id, matcher_revision,
    project_id, source_occurrence_id, parameter_locator_digest
  ) references parameter_catalog.parameter_observations (
    id, organization_id, catalog_release_id, matcher_revision,
    project_id, source_occurrence_id, parameter_locator_digest
  ) on delete restrict deferrable initially deferred;
alter table parameter_catalog.parameter_observation_matches
  add constraint parameter_observation_match_binding_occurrence_fk
  foreign key (
    binding_id, organization_id, project_id, source_occurrence_id,
    registration_id, subject_id, definition_id
  ) references parameter_catalog.project_parameter_bindings (
    id, organization_id, project_id, source_occurrence_id,
    registration_id, subject_id, definition_id
  ) on delete restrict deferrable initially deferred;

-- Deterministic DTS property winners.  A root and its ProjectValue pin must be
-- witnessed by the same final effect; never let a later delete or an arbitrary
-- tied effect disappear behind a first-match lookup.
create temporary table _0151_dts_property_effect_winners on commit drop as
select effect.id,
       effect.config_revision_id,
       effect.logical_node_revision_id,
       effect.property_name,
       effect.effect_kind,
       effect.node_occurrence_id,
       effect.property_occurrence_id,
       effect.source_order
from (
  select effect.*,
         max(effect.source_order) over (
           partition by effect.logical_node_revision_id, effect.property_name
         ) as max_source_order
  from public.dts_occurrence_effects effect
  join public.dts_logical_node_revisions logical_revision
    on logical_revision.id = effect.logical_node_revision_id
   and logical_revision.config_revision_id = effect.config_revision_id
  where effect.property_name is not null
) effect
where effect.source_order = effect.max_source_order;

do $$
begin
  if exists (
    select logical_node_revision_id, property_name
    from _0151_dts_property_effect_winners
    group by logical_node_revision_id, property_name
    having count(*) <> 1
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 DTS property has no unique final effect winner',
      detail = 'The migration refuses tied effects instead of selecting an arbitrary source occurrence.';
  end if;
end;
$$;

-- Deterministic DTS root candidates.  A root must be witnessed by the exact
-- historical revision/member/property graph; current_version_id is never read.
create temporary table _0151_binding_roots on commit drop as
select distinct
  binding.id as binding_id,
  binding.organization_id,
  binding.project_id,
  binding.definition_id,
  binding.logical_node_id,
  logical_node.config_set_id,
  occurrence.id as node_occurrence_id,
  occurrence.file_version_id,
  file_version.file_id
from parameter_catalog.project_parameter_bindings binding
join parameter_catalog.project_parameter_values current_value
  on current_value.id = binding.current_value_id
 and current_value.binding_id = binding.id
 and current_value.definition_id = binding.definition_id
join public.dts_logical_nodes logical_node
  on logical_node.id = binding.logical_node_id
 and logical_node.organization_id = binding.organization_id
 and logical_node.project_id = binding.project_id
join public.dts_logical_node_revisions logical_revision
  on logical_revision.logical_node_id = binding.logical_node_id
 and logical_revision.config_revision_id = current_value.config_revision_id
join parameter_catalog.parameter_definitions definition
  on definition.id = binding.definition_id
join _0151_dts_property_effect_winners effect
  on effect.logical_node_revision_id = logical_revision.id
 and effect.config_revision_id = current_value.config_revision_id
 and effect.property_name = definition.property_key
 and effect.effect_kind in ('set', 'override')
 and effect.node_occurrence_id is not null
join public.dts_node_occurrences occurrence
  on occurrence.id = effect.node_occurrence_id
 and occurrence.config_revision_id = current_value.config_revision_id
join public.project_parameter_file_versions file_version
  on file_version.id = occurrence.file_version_id
join public.project_parameter_files file
  on file.id = file_version.file_id
 and file.organization_id = binding.organization_id
 and file.project_id = binding.project_id
 and file.config_set_id = logical_node.config_set_id;

do $$
begin
  if exists (
    select binding.id
    from parameter_catalog.project_parameter_bindings binding
    left join (
      select binding_id, count(distinct (config_set_id, file_id, logical_node_id)) as roots
      from _0151_binding_roots
      group by binding_id
    ) roots on roots.binding_id = binding.id
    where roots.roots is distinct from 1
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every Binding root',
      detail = 'The migration is atomic; original schema/data remain unchanged.';
  end if;
end;
$$;

insert into parameter_catalog.project_parameter_source_occurrences (
  id, organization_id, project_id, config_set_id, file_id, occurrence_kind,
  logical_node_id
)
select
  'src_occ_dts_' || md5(
    concat_ws('|', root.organization_id, root.project_id, root.config_set_id,
      root.file_id, root.logical_node_id)
  ),
  root.organization_id,
  root.project_id,
  root.config_set_id,
  root.file_id,
  'dts',
  root.logical_node_id
from _0151_binding_roots root
group by root.organization_id, root.project_id, root.config_set_id,
  root.file_id, root.logical_node_id;

update parameter_catalog.project_parameter_bindings binding
set source_occurrence_id = occurrence.id
from _0151_binding_roots root
join parameter_catalog.project_parameter_source_occurrences occurrence
  on occurrence.organization_id = root.organization_id
 and occurrence.project_id = root.project_id
 and occurrence.config_set_id = root.config_set_id
 and occurrence.file_id = root.file_id
 and occurrence.logical_node_id = root.logical_node_id
where binding.id = root.binding_id;

set constraints all immediate;
alter table parameter_catalog.project_parameter_bindings
  alter column source_occurrence_id set not null;
create unique index if not exists project_parameter_bindings_occurrence_definition_uk
  on parameter_catalog.project_parameter_bindings (
    organization_id, project_id, source_occurrence_id, definition_id
  );

-- The effective Binding projection appends the new identity column while
-- preserving the existing view owner, grants and dependent readers.
create or replace view parameter_catalog.current_project_parameter_bindings as
select binding.*
from parameter_catalog.project_parameter_bindings binding
where not exists (
  select 1
  from parameter_catalog.definition_replacement_projects replacement
  where replacement.status = 'completed'
    and replacement.old_binding_id = binding.id
);
comment on view parameter_catalog.current_project_parameter_bindings is
  'Effective current Bindings with source occurrence identity; historical, pinned and revision-addressed reads use the exact Binding id.';

create temporary table _0151_value_pins on commit drop as
select
  value.id as project_value_id,
  value.binding_id,
  value.definition_id,
  binding.organization_id,
  binding.project_id,
  source_occurrence.id as source_occurrence_id,
  value.config_revision_id,
  file.id as file_id,
  occurrence.file_version_id,
  property.id as property_occurrence_id,
  jsonb_build_object(
    'kind', 'dts-property',
    'propertyOccurrenceId', property.id,
    'nodeOccurrenceId', property.node_occurrence_id,
    'fileVersionId', property.file_version_id,
    'propertyName', property.property_name
  ) as locator
from parameter_catalog.project_parameter_values value
join parameter_catalog.project_parameter_bindings binding
  on binding.id = value.binding_id
 and binding.definition_id = value.definition_id
join public.dts_logical_node_revisions logical_revision
  on logical_revision.logical_node_id = binding.logical_node_id
 and logical_revision.config_revision_id = value.config_revision_id
join parameter_catalog.parameter_definitions definition
  on definition.id = value.definition_id
join _0151_dts_property_effect_winners effect
  on effect.logical_node_revision_id = logical_revision.id
 and effect.config_revision_id = value.config_revision_id
 and effect.property_name = definition.property_key
 and effect.effect_kind in ('set', 'override')
 and effect.node_occurrence_id is not null
join public.dts_node_occurrences occurrence
  on occurrence.id = effect.node_occurrence_id
 and occurrence.config_revision_id = value.config_revision_id
join public.project_parameter_file_versions file_version
  on file_version.id = occurrence.file_version_id
join public.project_parameter_files file
  on file.id = file_version.file_id
 and file.organization_id = binding.organization_id
 and file.project_id = binding.project_id
join parameter_catalog.project_parameter_source_occurrences source_occurrence
  on source_occurrence.organization_id = binding.organization_id
 and source_occurrence.project_id = binding.project_id
 and source_occurrence.config_set_id = file.config_set_id
 and source_occurrence.file_id = file.id
 and source_occurrence.logical_node_id = binding.logical_node_id
join _0151_binding_roots root
  on root.binding_id = binding.id
  and root.config_set_id = file.config_set_id
  and root.file_id = file.id
  and root.logical_node_id = binding.logical_node_id
  and root.node_occurrence_id = occurrence.id
join public.dts_property_occurrences property
  on property.id = effect.property_occurrence_id
 and property.config_revision_id = value.config_revision_id
 and property.node_occurrence_id = occurrence.id
 and property.file_version_id = occurrence.file_version_id
 and property.property_name = definition.property_key;

do $$
begin
  if exists (
    select project_value_id
    from _0151_value_pins
    group by project_value_id
    having count(*) <> 1
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source pin backfill found ambiguous ProjectValue provenance',
      detail = 'The migration is atomic; no partial source pins are retained.';
  end if;

  if exists (
    select binding.id
    from parameter_catalog.project_parameter_bindings binding
    join parameter_catalog.project_parameter_values value
      on value.id = binding.current_value_id
     and value.binding_id = binding.id
    left join _0151_value_pins pin
      on pin.project_value_id = value.id
    where value.source_ref = 'canonical-binding-identity'
       or pin.project_value_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 current Binding tip has no proven source pin',
      detail = 'Current placeholder or unproven tips block workflow enablement.';
  end if;
end;
$$;

-- A canonical pin freezes every member of its revision, not only the member
-- that supplied the value.  Historical aliases can be recovered from an
-- immutable DTS source_ref (file-only or file!locator form) only when that value's exact winning property,
-- revision, file and file-version/member join is already proven by the pin
-- candidate above.  There is deliberately no fallback to the mutable
-- project_parameter_files.file_name or to a storage key.
create temporary table _0151_source_member_alias_candidates on commit drop as
select
  pinned_revision.config_revision_id,
  member.id as member_id,
  member.source_name as existing_source_name,
  array_agg(distinct parameter_catalog.normalize_dts_source_name(split_part(value.source_ref, '!', 1)))
    filter (where value.source_ref ~ '^[^!]+!.+$'
             or value.source_ref ~ '^[^!]+\.dts$') as evidence_source_names
from (
  select distinct config_revision_id
  from _0151_value_pins
) pinned_revision
join public.dts_config_revision_members member
  on member.config_revision_id = pinned_revision.config_revision_id
left join _0151_value_pins pin
  on pin.config_revision_id = member.config_revision_id
 and pin.file_id = member.file_id
 and pin.file_version_id = member.file_version_id
left join parameter_catalog.project_parameter_values value
  on value.id = pin.project_value_id
group by pinned_revision.config_revision_id, member.id, member.source_name;

do $$
declare
  candidate record;
begin
  for candidate in
    select config_revision_id, member_id, existing_source_name, evidence_source_names
    from _0151_source_member_alias_candidates
  loop
    if candidate.existing_source_name is not null
       and parameter_catalog.normalize_dts_source_name(candidate.existing_source_name)
           is distinct from candidate.existing_source_name then
      raise exception using
        errcode = '23514',
        message = '0151 pinned DTS member has a non-canonical source_name',
        detail = format('revision=%s member=%s', candidate.config_revision_id, candidate.member_id);
    end if;
    if cardinality(coalesce(candidate.evidence_source_names, array[]::text[])) > 1
       or (
         candidate.existing_source_name is not null
         and cardinality(coalesce(candidate.evidence_source_names, array[]::text[])) = 1
         and candidate.existing_source_name is distinct from candidate.evidence_source_names[1]
       )
       or (
         candidate.existing_source_name is null
         and cardinality(coalesce(candidate.evidence_source_names, array[]::text[])) = 0
       ) then
      raise exception using
        errcode = '23514',
        message = '0151 pinned DTS revision member alias is unprovable or conflicting',
        detail = format('revision=%s member=%s; only one immutable source_ref or historical manifest alias is accepted',
          candidate.config_revision_id, candidate.member_id);
    end if;
  end loop;
end;
$$;

update public.dts_config_revision_members member
set source_name = coalesce(member.source_name, candidates.evidence_source_names[1])
from _0151_source_member_alias_candidates candidates
where candidates.member_id = member.id
  and candidates.config_revision_id = member.config_revision_id
  and member.source_name is null;

do $$
begin
  if exists (
    select 1
    from _0151_source_member_alias_candidates candidates
    join public.dts_config_revision_members member
      on member.id = candidates.member_id
     and member.config_revision_id = candidates.config_revision_id
    where member.source_name is null
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 pinned DTS revision member alias backfill is incomplete',
      detail = 'Every member of every pinned revision needs proven immutable naming evidence.';
  end if;
  if exists (
    select member.config_revision_id, member.source_name
    from public.dts_config_revision_members member
    join (select distinct config_revision_id from _0151_value_pins) pinned
      on pinned.config_revision_id = member.config_revision_id
    group by member.config_revision_id, member.source_name
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 pinned DTS revision has duplicate normalized source_name aliases',
      detail = 'Aliases are unique across all members in a revision.';
  end if;
end;
$$;

insert into parameter_catalog.project_value_source_pins (
  id, project_value_id, binding_id, definition_id, organization_id, project_id,
  source_occurrence_id, config_revision_id, file_id, file_version_id, format,
  property_occurrence_id, locator, locator_digest
)
select
  'src_pin_' || md5(pin.project_value_id),
  pin.project_value_id,
  pin.binding_id,
  pin.definition_id,
  pin.organization_id,
  pin.project_id,
  pin.source_occurrence_id,
  pin.config_revision_id,
  pin.file_id,
  pin.file_version_id,
  'dts',
  pin.property_occurrence_id,
  pin.locator,
  parameter_catalog.canonical_dts_parameter_locator_digest(pin.locator)
from _0151_value_pins pin;

update public.project_parameter_value_drafts draft
set source_pin_id = pin.id
from parameter_catalog.project_value_source_pins pin
where pin.project_value_id = draft.base_current_value_id
  and pin.binding_id = draft.binding_id;
update public.project_parameter_value_change_requests request
set source_pin_id = pin.id
from parameter_catalog.project_value_source_pins pin
where pin.project_value_id = request.base_current_value_id
  and pin.binding_id = request.binding_id;

do $$
begin
  if exists (
    select 1 from public.project_parameter_value_drafts where source_pin_id is null
  ) or exists (
    select 1 from public.project_parameter_value_change_requests
    where status = 'pending' and source_pin_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 pending canonical work has no exact source pin',
      detail = 'The migration refuses to invent provenance for drafts or requests.';
  end if;
end;
$$;

-- Observation/match rows retain their IDs while gaining occurrence and exact
-- locator-digest ownership.  Derive the root from each observation's own
-- typed locator and historical graph, never from a current Binding tip or the
-- temporary Binding-root projection above.
create temporary table _0151_observation_roots on commit drop as
select
  observation.id as observation_id,
  observation.organization_id,
  observation.project_id,
  observation.config_revision_id,
  logical_node.config_set_id,
  file.id as file_id,
  observation.logical_node_id,
  node_occurrence.id as node_occurrence_id,
  property.id as property_occurrence_id,
  effect.id as effect_id,
  observation.source_locator
from parameter_catalog.parameter_observations observation
join public.dts_logical_nodes logical_node
  on logical_node.id = observation.logical_node_id
 and logical_node.organization_id = observation.organization_id
 and logical_node.project_id = observation.project_id
join public.dts_logical_node_revisions logical_revision
  on logical_revision.logical_node_id = observation.logical_node_id
 and logical_revision.config_revision_id = observation.config_revision_id
join public.dts_config_revisions revision
  on revision.id = observation.config_revision_id
 and revision.organization_id = observation.organization_id
 and revision.project_id = observation.project_id
 and revision.config_set_id = logical_node.config_set_id
join public.dts_config_revision_members member
  on member.config_revision_id = revision.id
 and member.file_version_id = observation.source_locator ->> 'fileVersionId'
join public.project_parameter_file_versions file_version
  on file_version.id = member.file_version_id
 and file_version.file_id = member.file_id
join public.dts_occurrence_effects effect
  on effect.logical_node_revision_id = logical_revision.id
 and effect.config_revision_id = revision.id
 and effect.node_occurrence_id = observation.source_locator ->> 'nodeOccurrenceId'
 and effect.property_occurrence_id = observation.source_locator ->> 'propertyOccurrenceId'
 and effect.property_name = observation.source_locator ->> 'propertyName'
 and effect.effect_kind in ('set', 'override')
join public.dts_node_occurrences node_occurrence
  on node_occurrence.id = observation.source_locator ->> 'nodeOccurrenceId'
 and node_occurrence.config_revision_id = revision.id
 and node_occurrence.file_version_id = member.file_version_id
join public.project_parameter_files file
  on file.id = member.file_id
 and file.organization_id = observation.organization_id
 and file.project_id = observation.project_id
 and file.config_set_id = logical_node.config_set_id
join public.dts_property_occurrences property
  on property.id = observation.source_locator ->> 'propertyOccurrenceId'
 and property.config_revision_id = revision.id
 and property.node_occurrence_id = node_occurrence.id
 and property.file_version_id = member.file_version_id
 and property.property_name = observation.source_locator ->> 'propertyName'
where jsonb_typeof(observation.source_locator) = 'object'
  and (select count(*) from jsonb_object_keys(observation.source_locator)) = 5
  and not exists (
    select 1
    from jsonb_object_keys(observation.source_locator) key_name
    where key_name not in (
      'kind', 'propertyOccurrenceId', 'nodeOccurrenceId',
      'fileVersionId', 'propertyName'
    )
  )
  and observation.source_locator ->> 'kind' = 'dts-property'
  and not exists (
    select 1
    from jsonb_each(observation.source_locator) entry
    where jsonb_typeof(entry.value) <> 'string'
  );

do $$
begin
  if exists (
    select observation.id
    from parameter_catalog.parameter_observations observation
    left join (
      select observation_id, count(*) as roots
      from _0151_observation_roots
      group by observation_id
    ) roots on roots.observation_id = observation.id
    where roots.roots is distinct from 1
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every observation locator',
      detail = 'Observation provenance must resolve to exactly one historical typed locator and root.';
  end if;
end;
$$;

-- An observation may be the first witness of its root (for example, a
-- historical review row whose Binding is absent).  Reuse an exact natural
-- occurrence row if one already came from Binding backfill, otherwise create
-- it now and prove its owner through the same tenant-complete keys.
insert into parameter_catalog.project_parameter_source_occurrences (
  id, organization_id, project_id, config_set_id, file_id, occurrence_kind,
  logical_node_id
)
select
  'src_occ_dts_' || md5(
    concat_ws('|', root.organization_id, root.project_id, root.config_set_id,
      root.file_id, root.logical_node_id)
  ),
  root.organization_id,
  root.project_id,
  root.config_set_id,
  root.file_id,
  'dts',
  root.logical_node_id
from _0151_observation_roots root
group by root.organization_id, root.project_id, root.config_set_id,
  root.file_id, root.logical_node_id
on conflict do nothing;

-- Legacy catalog rows are append-only to application writers, but this
-- migration must add links to already-persisted rows.  Remove only the two
-- generic immutable-row guards for the duration of this transaction; a failed
-- upgrade rolls the drops back, and the original guards are restored below.
drop trigger if exists parameter_observations_immutable
  on parameter_catalog.parameter_observations;
drop trigger if exists parameter_observation_matches_immutable
  on parameter_catalog.parameter_observation_matches;

update parameter_catalog.parameter_observations observation
set source_occurrence_id = occurrence.id,
    parameter_locator_digest = parameter_catalog.canonical_dts_parameter_locator_digest(observation.source_locator)
from _0151_observation_roots root
join parameter_catalog.project_parameter_source_occurrences occurrence
  on occurrence.organization_id = root.organization_id
 and occurrence.project_id = root.project_id
 and occurrence.config_set_id = root.config_set_id
 and occurrence.file_id = root.file_id
 and occurrence.logical_node_id = root.logical_node_id
where observation.id = root.observation_id;

do $$
begin
  if exists (
    select 1
    from parameter_catalog.parameter_observations observation
    where observation.source_occurrence_id is null
       or observation.parameter_locator_digest is null
       or observation.parameter_locator_digest
          is distinct from parameter_catalog.canonical_dts_parameter_locator_digest(observation.source_locator)
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every observation locator',
      detail = 'The migration refuses unsupported, ambiguous or non-canonical historical locators.';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from parameter_catalog.parameter_observation_matches match
    join parameter_catalog.parameter_observations observation
      on observation.id = match.observation_id
    left join parameter_catalog.project_parameter_bindings binding
      on binding.id = match.binding_id
     and binding.organization_id = match.organization_id
     and binding.project_id = match.project_id
    where match.organization_id is distinct from observation.organization_id
       or match.project_id is distinct from observation.project_id
       or match.catalog_release_id is distinct from observation.catalog_release_id
       or match.matcher_revision is distinct from observation.matcher_revision
       or match.logical_node_id is distinct from observation.logical_node_id
       or binding.id is null
       or binding.source_occurrence_id is distinct from observation.source_occurrence_id
       or binding.registration_id is distinct from match.registration_id
       or binding.subject_id is distinct from match.subject_id
       or binding.definition_id is distinct from match.definition_id
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every observation match',
      detail = 'Match ownership must agree with the observation, Binding and tenant-complete source root.';
  end if;
end;
$$;

update parameter_catalog.parameter_observation_matches match
set source_occurrence_id = observation.source_occurrence_id,
    parameter_locator_digest = observation.parameter_locator_digest
from parameter_catalog.parameter_observations observation
where observation.id = match.observation_id
  and (match.source_occurrence_id is null or match.parameter_locator_digest is null);

do $$
begin
  if exists (
    select 1
    from parameter_catalog.parameter_observations observation
    where observation.source_occurrence_id is null
       or observation.parameter_locator_digest is null
       or observation.parameter_locator_digest !~ '^sha256:[0-9a-f]{64}$'
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every observation locator',
      detail = 'The migration refuses to derive ownership from source_identity or an untyped locator.';
  end if;
  if exists (
    select 1
    from parameter_catalog.parameter_observation_matches match
    where match.source_occurrence_id is null
       or match.parameter_locator_digest is null
       or match.parameter_locator_digest !~ '^sha256:[0-9a-f]{64}$'
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every observation match',
      detail = 'The migration refuses to derive match ownership from a legacy logical node alone.';
  end if;
end;
$$;

set constraints all immediate;
alter table parameter_catalog.parameter_observations
  alter column source_occurrence_id set not null,
  alter column parameter_locator_digest set not null;
alter table parameter_catalog.parameter_observation_matches
  alter column source_occurrence_id set not null,
  alter column parameter_locator_digest set not null;

create trigger parameter_observations_immutable
before update or delete on parameter_catalog.parameter_observations
for each row execute function parameter_catalog.reject_immutable_catalog_change();
create trigger parameter_observation_matches_immutable
before update or delete on parameter_catalog.parameter_observation_matches
for each row execute function parameter_catalog.reject_immutable_catalog_change();

create unique index if not exists parameter_observation_exact_replay_uk
  on parameter_catalog.parameter_observations (
    organization_id, project_id, source_occurrence_id, config_revision_id,
    parameter_locator_digest, catalog_release_id, matcher_revision
  );

do $$
begin
  if exists (
    select 1
    from parameter_catalog.parameter_observation_matches match
    where match.source_occurrence_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = '0151 source occurrence backfill cannot prove every observation match';
  end if;
end;
$$;

create or replace function parameter_catalog.protect_source_occurrence_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE'
     or new.id is distinct from old.id
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
create trigger project_parameter_source_occurrences_immutable
before update or delete on parameter_catalog.project_parameter_source_occurrences
for each row execute function parameter_catalog.protect_source_occurrence_identity();

create or replace function parameter_catalog.json_pointer_contains(
  p_root_pointer text,
  p_parameter_pointer text
)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  root_tokens text[];
  parameter_tokens text[];
  token_index integer;
begin
  if p_root_pointer = '' then
    return true;
  end if;
  if p_parameter_pointer = '' then
    return false;
  end if;
  root_tokens := string_to_array(substr(p_root_pointer, 2), '/');
  parameter_tokens := string_to_array(substr(p_parameter_pointer, 2), '/');
  if cardinality(parameter_tokens) < cardinality(root_tokens) then
    return false;
  end if;
  for token_index in 1..cardinality(root_tokens) loop
    if replace(replace(root_tokens[token_index], '~1', '/'), '~0', '~')
       is distinct from
       replace(replace(parameter_tokens[token_index], '~1', '/'), '~0', '~') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function parameter_catalog.assert_project_value_source_pin_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  binding_occurrence text;
  value_binding text;
  value_definition text;
  value_config_revision text;
  pin_provenance_valid boolean;
begin
  select value.binding_id, value.definition_id, value.config_revision_id
    into value_binding, value_definition, value_config_revision
  from parameter_catalog.project_parameter_values value
  where value.id = new.project_value_id;
  select binding.source_occurrence_id into binding_occurrence
  from parameter_catalog.project_parameter_bindings binding
  where binding.id = new.binding_id
    and binding.organization_id = new.organization_id
    and binding.project_id = new.project_id;
  if value_binding is distinct from new.binding_id
     or value_definition is distinct from new.definition_id
     or binding_occurrence is distinct from new.source_occurrence_id then
    raise exception using errcode = '23503', message = 'ProjectValue source pin owner mismatch';
  end if;

  select exists (
    select 1
    from parameter_catalog.project_value_source_pins pin
    join parameter_catalog.project_parameter_bindings binding
      on binding.id = pin.binding_id
     and binding.organization_id = pin.organization_id
     and binding.project_id = pin.project_id
    join parameter_catalog.project_parameter_values value
      on value.id = pin.project_value_id
     and value.binding_id = pin.binding_id
     and value.definition_id = pin.definition_id
    join parameter_catalog.project_parameter_source_occurrences occurrence
      on occurrence.id = pin.source_occurrence_id
     and occurrence.organization_id = pin.organization_id
     and occurrence.project_id = pin.project_id
    join public.dts_config_revisions revision
      on revision.id = pin.config_revision_id
     and revision.organization_id = pin.organization_id
     and revision.project_id = pin.project_id
     and revision.config_set_id = occurrence.config_set_id
    join public.dts_config_revision_members member
      on member.config_revision_id = pin.config_revision_id
     and member.file_id = pin.file_id
     and member.file_version_id = pin.file_version_id
     and member.source_name is not null
    join public.project_parameter_file_versions file_version
      on file_version.id = pin.file_version_id
     and file_version.file_id = pin.file_id
    join public.project_parameter_files file
      on file.id = pin.file_id
     and file.organization_id = pin.organization_id
     and file.project_id = pin.project_id
     and file.config_set_id = occurrence.config_set_id
     and file.id = occurrence.file_id
    join parameter_catalog.parameter_definitions definition
      on definition.id = pin.definition_id
    where pin.id = new.id
      and pin.project_value_id = new.project_value_id
      and pin.binding_id = new.binding_id
      and pin.definition_id = new.definition_id
      and pin.organization_id = new.organization_id
      and pin.project_id = new.project_id
      and pin.source_occurrence_id = binding_occurrence
      and pin.config_revision_id = value_config_revision
      and not exists (
        select 1
        from public.dts_config_revision_members missing_member
        where missing_member.config_revision_id = pin.config_revision_id
          and missing_member.source_name is null
      )
      and (
        (
          pin.format = 'dts'
          and occurrence.occurrence_kind = 'dts'
          and pin.property_occurrence_id is not null
          and exists (
            select 1
            from public.dts_property_occurrences property
            join public.dts_node_occurrences node
              on node.id = property.node_occurrence_id
             and node.config_revision_id = property.config_revision_id
             and node.file_version_id = property.file_version_id
            join public.dts_occurrence_effects effect
              on effect.property_occurrence_id = property.id
             and effect.node_occurrence_id = node.id
             and effect.config_revision_id = property.config_revision_id
            join public.dts_logical_node_revisions logical_revision
              on logical_revision.id = effect.logical_node_revision_id
             and logical_revision.logical_node_id = occurrence.logical_node_id
             and logical_revision.config_revision_id = property.config_revision_id
            where property.id = pin.property_occurrence_id
              and property.config_revision_id = pin.config_revision_id
              and property.file_version_id = pin.file_version_id
              and property.property_name = definition.property_key
              and property.property_name = pin.locator->>'propertyName'
              and pin.locator->>'propertyOccurrenceId' = property.id
              and pin.locator->>'nodeOccurrenceId' = node.id
              and pin.locator->>'fileVersionId' = property.file_version_id
          )
        )
        or
        (
          pin.format = 'json'
          and occurrence.occurrence_kind = 'json'
          and pin.property_occurrence_id is null
          and revision.config_set_id = occurrence.config_set_id
          and exists (
            select 1
            from parameter_catalog.organization_subject_registrations registration
            where registration.organization_id = pin.organization_id
              and registration.subject_id = occurrence.configuration_schema_subject_id
              and registration.status = 'active'
          )
          and pin.locator->>'kind' = 'json-pointer'
          and occurrence.configuration_schema_subject_id = binding.subject_id
          and parameter_catalog.json_pointer_contains(
            occurrence.root_pointer,
            pin.locator->>'pointer'
          )
        )
      )
  ) into pin_provenance_valid;
  if not pin_provenance_valid then
    raise exception using
      errcode = '23503',
      message = 'ProjectValue source pin does not prove its exact revision, member and locator';
  end if;
  return null;
end;
$$;
create constraint trigger project_value_source_pin_owner_fk
after insert or update on parameter_catalog.project_value_source_pins
deferrable initially deferred
for each row execute function parameter_catalog.assert_project_value_source_pin_owner();

create or replace function parameter_catalog.reject_immutable_project_value_source_pin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'ProjectValue source pins are immutable';
end;
$$;
create trigger project_value_source_pins_immutable
before update or delete on parameter_catalog.project_value_source_pins
for each row execute function parameter_catalog.reject_immutable_project_value_source_pin();

create or replace function parameter_catalog.assert_binding_current_source_pin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  final_current_value_id text;
  final_source_occurrence_id text;
begin
  -- Constraint triggers can retain the NEW row from an initial Binding insert
  -- while the same transaction appends the canonical ProjectValue and updates
  -- the source occurrence.  Re-read the committed-in-transaction owner row so
  -- a valid append is not rejected because the trigger event was transient.
  select binding.current_value_id, binding.source_occurrence_id
    into final_current_value_id, final_source_occurrence_id
  from parameter_catalog.project_parameter_bindings binding
  where binding.id = new.id;
  if not exists (
    select 1
    from parameter_catalog.project_parameter_values value
    join parameter_catalog.project_value_source_pins pin
      on pin.project_value_id = value.id
     and pin.binding_id = value.binding_id
     and pin.definition_id = value.definition_id
     and pin.source_occurrence_id = final_source_occurrence_id
    where value.id = final_current_value_id
      and value.binding_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A current canonical Binding value requires an exact source pin',
      constraint = 'project_parameter_binding_current_source_pin_ck';
  end if;
  return null;
end;
$$;
create constraint trigger project_parameter_binding_current_source_pin_ck
after insert or update of current_value_id, source_occurrence_id
on parameter_catalog.project_parameter_bindings
deferrable initially deferred
for each row execute function parameter_catalog.assert_binding_current_source_pin();

-- Once backfill has assigned an occurrence, identity can no longer be moved or
-- deleted.  The nullable expansion column remains for legacy rows only during
-- the transaction; this migration does not silently quarantine an unproven row.
create or replace function parameter_catalog.protect_project_parameter_binding_source_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE'
     or (old.source_occurrence_id is not null
       and new.source_occurrence_id is distinct from old.source_occurrence_id) then
    raise exception using errcode = '55000', message = 'Binding source occurrence identity is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_binding_source_identity_immutable
before update or delete on parameter_catalog.project_parameter_bindings
for each row execute function parameter_catalog.protect_project_parameter_binding_source_identity();

-- Candidate/request snapshots are server-owned.  Legacy candidates and old
-- drafts remain nullable until explicitly prepared by the source workflow.
alter table public.project_parameter_file_candidates
  add column if not exists base_digest text,
  add column if not exists proposed_digest text,
  add column if not exists diff_digest text,
  add column if not exists frozen_member_manifest jsonb,
  add column if not exists frozen_binding_manifest jsonb,
  add constraint project_parameter_file_candidates_artifact_group_ck check (
    (base_digest is null and proposed_digest is null and diff_digest is null
      and frozen_member_manifest is null and frozen_binding_manifest is null)
    or (base_digest is not null and proposed_digest is not null and diff_digest is not null
      and jsonb_typeof(frozen_member_manifest) = 'array'
      and jsonb_typeof(frozen_binding_manifest) = 'array')
  );

alter table public.project_parameter_value_drafts
  add constraint project_parameter_value_draft_candidate_artifact_ck check (
    (candidate_id is null
      and candidate_base_digest is null
      and candidate_proposed_digest is null
      and candidate_diff_digest is null
      and candidate_member_manifest is null
      and candidate_binding_manifest is null)
    or (candidate_id is not null
      and candidate_base_digest is not null
      and candidate_proposed_digest is not null
      and candidate_diff_digest is not null
      and jsonb_typeof(candidate_member_manifest) = 'array'
      and jsonb_typeof(candidate_binding_manifest) = 'array')
  );
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_request_candidate_artifact_ck check (
    (candidate_id is null
      and candidate_base_digest is null
      and candidate_proposed_digest is null
      and candidate_diff_digest is null
      and candidate_member_manifest is null
      and candidate_binding_manifest is null)
    or (candidate_id is not null
      and candidate_base_digest is not null
      and candidate_proposed_digest is not null
      and candidate_diff_digest is not null
      and jsonb_typeof(candidate_member_manifest) = 'array'
      and jsonb_typeof(candidate_binding_manifest) = 'array')
  );

alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_request_applied_source_result_ck check (
    applied_source_result is null or jsonb_typeof(applied_source_result) = 'object'
  );

create or replace function parameter_catalog.protect_submitted_candidate_payload()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if exists (
    select 1
    from public.project_parameter_value_change_requests request
    where request.candidate_id = old.id
  ) and (
    new.file_id is distinct from old.file_id
    or new.file_name is distinct from old.file_name
    or new.format is distinct from old.format
    or new.base_version_id is distinct from old.base_version_id
    or new.storage_key is distinct from old.storage_key
    or new.checksum is distinct from old.checksum
    or new.size_bytes is distinct from old.size_bytes
    or new.parsed_index is distinct from old.parsed_index
    or new.diagnostics is distinct from old.diagnostics
    or new.impact is distinct from old.impact
    or new.blockers is distinct from old.blockers
    or new.base_digest is distinct from old.base_digest
    or new.proposed_digest is distinct from old.proposed_digest
    or new.diff_digest is distinct from old.diff_digest
    or new.frozen_member_manifest is distinct from old.frozen_member_manifest
    or new.frozen_binding_manifest is distinct from old.frozen_binding_manifest
  ) then
    raise exception using errcode = '55000', message = 'Submitted candidate payload is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_file_candidate_submitted_payload_immutable
before update on public.project_parameter_file_candidates
for each row execute function parameter_catalog.protect_submitted_candidate_payload();

create or replace function parameter_catalog.protect_submitted_source_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op <> 'DELETE'
     and old.status = 'approved'
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

  if tg_op = 'DELETE'
     or new.organization_id is distinct from old.organization_id
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
create trigger project_parameter_value_change_request_source_immutable
before update or delete on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.protect_submitted_source_request();

create or replace function parameter_catalog.assert_source_candidate_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  candidate_base text;
  candidate_proposed text;
  candidate_diff text;
  candidate_manifest jsonb;
  candidate_binding_manifest jsonb;
begin
  if new.candidate_id is null then
    return null;
  end if;

  select candidate.base_digest,
         candidate.proposed_digest,
         candidate.diff_digest,
         candidate.frozen_member_manifest,
         candidate.frozen_binding_manifest
    into candidate_base, candidate_proposed, candidate_diff,
         candidate_manifest, candidate_binding_manifest
  from public.project_parameter_file_candidates candidate
  where candidate.id = new.candidate_id
    and candidate.organization_id = new.organization_id
    and candidate.project_id = new.project_id;

  if candidate_base is null
     or candidate_proposed is null
     or candidate_diff is null
     or jsonb_typeof(candidate_manifest) is distinct from 'array'
     or jsonb_typeof(candidate_binding_manifest) is distinct from 'array'
     or new.candidate_base_digest is distinct from candidate_base
     or new.candidate_proposed_digest is distinct from candidate_proposed
     or new.candidate_diff_digest is distinct from candidate_diff
     or new.candidate_member_manifest is distinct from candidate_manifest
     or new.candidate_binding_manifest is distinct from candidate_binding_manifest then
    raise exception using
      errcode = '23514',
      message = 'Source workflow candidate snapshot does not match the prepared candidate';
  end if;

  -- The member manifest is a frozen parser/export input.  Check each alias
  -- against the immutable revision member under the request tenant; a JSON
  -- object that merely repeats a caller-selected sourceName is not proof.
  if exists (
    select 1
    from jsonb_array_elements(candidate_manifest) item
    left join public.dts_config_revision_members member
      on member.id = item ->> 'memberId'
     and member.file_id = item ->> 'fileId'
     and member.file_version_id = item ->> 'fileVersionId'
    left join public.dts_config_revisions revision
      on revision.id = member.config_revision_id
     and revision.organization_id = new.organization_id
     and revision.project_id = new.project_id
    left join public.project_parameter_files file
      on file.id = member.file_id
     and file.organization_id = new.organization_id
     and file.project_id = new.project_id
    where jsonb_typeof(item) is distinct from 'object'
       or member.id is null
       or revision.id is null
       or file.id is null
       or member.source_name is null
       or (item ->> 'sourceName') is distinct from member.source_name
  ) then
    raise exception using
      errcode = '23514',
      message = 'Source workflow candidate manifest has an unproven member sourceName';
  end if;
  return null;
end;
$$;
create constraint trigger project_parameter_value_draft_candidate_snapshot_ck
after insert or update of candidate_id, candidate_base_digest, candidate_proposed_digest,
  candidate_diff_digest, candidate_member_manifest, candidate_binding_manifest
on public.project_parameter_value_drafts
deferrable initially deferred
for each row execute function parameter_catalog.assert_source_candidate_snapshot();
create constraint trigger project_parameter_value_change_request_candidate_snapshot_ck
after insert or update of candidate_id, candidate_base_digest, candidate_proposed_digest,
  candidate_diff_digest, candidate_member_manifest, candidate_binding_manifest
on public.project_parameter_value_change_requests
deferrable initially deferred
for each row execute function parameter_catalog.assert_source_candidate_snapshot();

-- The applied result is a compact, ordered cohort receipt.  Validate its
-- identity and ownership at commit so sibling history rows cannot masquerade
-- as the one request-applied event or cross a tenant/config revision boundary.
create or replace function parameter_catalog.assert_source_apply_result()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  item jsonb;
  item_ordinal bigint;
  item_kind text;
  target_count integer := 0;
begin
  if new.applied_source_result is null then
    return null;
  end if;
  if new.status is distinct from 'approved'
     or jsonb_typeof(new.applied_source_result) is distinct from 'object'
     or jsonb_typeof(new.applied_source_result -> 'bindings') is distinct from 'array'
     or jsonb_array_length(new.applied_source_result -> 'bindings') = 0 then
    raise exception using
      errcode = '23514',
      message = 'Applied source result must be a non-empty object bindings array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.applied_source_result -> 'bindings') with ordinality left_item
    join jsonb_array_elements(new.applied_source_result -> 'bindings') with ordinality right_item
      on left_item.ordinality < right_item.ordinality
     and left_item.value ->> 'ordinal' = right_item.value ->> 'ordinal'
  ) then
    raise exception using errcode = '23514', message = 'Applied source result ordinals must be unique';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.applied_source_result -> 'bindings') with ordinality left_item
    join jsonb_array_elements(new.applied_source_result -> 'bindings') with ordinality right_item
      on left_item.ordinality < right_item.ordinality
     and left_item.value ->> 'bindingId' = right_item.value ->> 'bindingId'
  ) then
    raise exception using errcode = '23514', message = 'Applied source result Binding IDs must be unique';
  end if;

  for item, item_ordinal in
    select value, ordinality - 1
    from jsonb_array_elements(new.applied_source_result -> 'bindings') with ordinality
  loop
    item_kind := item ->> 'kind';
    if jsonb_typeof(item) is distinct from 'object'
       or item ->> 'ordinal' is null
       or item ->> 'ordinal' !~ '^[0-9]+$'
       or (item ->> 'ordinal')::bigint <> item_ordinal
       or item_kind not in ('target', 'sibling-derived')
       or nullif(item ->> 'bindingId', '') is null
       or nullif(item ->> 'oldValueId', '') is null
       or nullif(item ->> 'newValueId', '') is null
       or nullif(item ->> 'sourcePinId', '') is null
       or nullif(item ->> 'configRevisionId', '') is null
       or nullif(item ->> 'fileVersionId', '') is null
       or nullif(item ->> 'historyEventId', '') is null then
      raise exception using errcode = '23514', message = 'Applied source result item is incomplete';
    end if;

    if not exists (
      select 1
      from parameter_catalog.project_parameter_bindings binding
      where binding.id = item ->> 'bindingId'
        and binding.organization_id = new.organization_id
        and binding.project_id = new.project_id
    ) then
      raise exception using errcode = '23503', message = 'Applied source result Binding owner mismatch';
    end if;
    if not exists (
      select 1
      from parameter_catalog.project_parameter_values old_value
      where old_value.id = item ->> 'oldValueId'
        and old_value.binding_id = item ->> 'bindingId'
    ) or not exists (
      select 1
      from parameter_catalog.project_parameter_values new_value
      where new_value.id = item ->> 'newValueId'
        and new_value.binding_id = item ->> 'bindingId'
        and new_value.config_revision_id = item ->> 'configRevisionId'
    ) then
      raise exception using errcode = '23503', message = 'Applied source result value owner mismatch';
    end if;
    if not exists (
      select 1
      from parameter_catalog.project_value_source_pins pin
      where pin.id = item ->> 'sourcePinId'
        and pin.organization_id = new.organization_id
        and pin.project_id = new.project_id
        and pin.binding_id = item ->> 'bindingId'
        and pin.project_value_id = item ->> 'newValueId'
        and pin.config_revision_id = item ->> 'configRevisionId'
        and pin.file_version_id = item ->> 'fileVersionId'
    ) then
      raise exception using errcode = '23503', message = 'Applied source result source pin owner mismatch';
    end if;
    if not exists (
      select 1
      from public.dts_config_revisions revision
      join public.dts_config_revision_members member
        on member.config_revision_id = revision.id
       and member.file_version_id = item ->> 'fileVersionId'
      join public.project_parameter_file_versions version
        on version.id = member.file_version_id
       and version.file_id = member.file_id
      join public.project_parameter_files file
        on file.id = version.file_id
       and file.organization_id = new.organization_id
       and file.project_id = new.project_id
      where revision.id = item ->> 'configRevisionId'
        and revision.organization_id = new.organization_id
        and revision.project_id = new.project_id
    ) then
      raise exception using errcode = '23503', message = 'Applied source result revision member owner mismatch';
    end if;
    if not exists (
      select 1
      from parameter_catalog.binding_history_events history
      where history.id = item ->> 'historyEventId'
        and history.binding_id = item ->> 'bindingId'
        and history.old_current_value_id = item ->> 'oldValueId'
        and history.new_current_value_id = item ->> 'newValueId'
        and (
          (item_kind = 'target' and history.applied_request_id = new.id)
          or (item_kind = 'sibling-derived' and history.applied_request_id is null)
        )
    ) then
      raise exception using errcode = '23503', message = 'Applied source result history owner mismatch';
    end if;
    if (new.applied_file_version_ids @> jsonb_build_array(item ->> 'fileVersionId')) is not true then
      raise exception using errcode = '23514', message = 'Applied source result file version is not in the request result';
    end if;

    if item_kind = 'target' then
      target_count := target_count + 1;
      if item ->> 'bindingId' is distinct from new.binding_id
         or item ->> 'oldValueId' <> new.base_current_value_id
         or item ->> 'newValueId' <> new.applied_value_id
         or item ->> 'historyEventId' <> new.applied_history_event_id then
        raise exception using errcode = '23514', message = 'Applied source result target does not match the request';
      end if;
    end if;
  end loop;

  if target_count <> 1 then
    raise exception using errcode = '23514', message = 'Applied source result must contain exactly one target';
  end if;
  return null;
end;
$$;
create constraint trigger project_parameter_value_change_request_applied_source_result_owner_ck
after insert or update of status, applied_value_id, applied_at, apply_outcome,
  applied_history_event_id, applied_audit_ref, applied_file_version_ids,
  applied_source_result
on public.project_parameter_value_change_requests
deferrable initially deferred
for each row execute function parameter_catalog.assert_source_apply_result();

-- Governance writers may append observations but cannot read the source graph.
-- Prove the exact historical revision/member/occurrence/locator here, under the
-- migration owner, at commit. Also verify the digest of the exact typed locator
-- using the same canonical UTF-8 representation as evidence ingestion.
create or replace function parameter_catalog.assert_parameter_observation_source_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  locator_kind text;
  source_provenance_valid boolean := false;
begin
  locator_kind := new.source_locator ->> 'kind';
  if new.source_occurrence_id is null
     or new.parameter_locator_digest is null
     or jsonb_typeof(new.source_locator) is distinct from 'object'
     or jsonb_typeof(new.source_locator -> 'kind') is distinct from 'string'
     or locator_kind not in ('dts-property', 'json-pointer') then
    raise exception using
      errcode = '23503',
      message = 'Parameter observation source provenance is incomplete',
      constraint = 'parameter_observation_source_owner_fk';
  end if;

  if locator_kind = 'dts-property' then
    select exists (
      select 1
      from parameter_catalog.project_parameter_source_occurrences occurrence
      join public.project_parameter_files file
        on file.id = occurrence.file_id
       and file.organization_id = new.organization_id
       and file.project_id = new.project_id
       and file.config_set_id = occurrence.config_set_id
      join public.dts_config_revisions revision
        on revision.id = new.config_revision_id
       and revision.organization_id = new.organization_id
       and revision.project_id = new.project_id
       and revision.config_set_id = occurrence.config_set_id
      join public.dts_config_revision_members member
        on member.config_revision_id = revision.id
       and member.file_id = occurrence.file_id
       and member.file_version_id = new.source_locator ->> 'fileVersionId'
      join public.dts_node_occurrences node
        on node.id = new.source_locator ->> 'nodeOccurrenceId'
       and node.config_revision_id = revision.id
       and node.file_version_id = member.file_version_id
      join public.dts_property_occurrences property
        on property.id = new.source_locator ->> 'propertyOccurrenceId'
       and property.config_revision_id = revision.id
       and property.node_occurrence_id = node.id
       and property.file_version_id = member.file_version_id
       and property.property_name = new.source_locator ->> 'propertyName'
      join public.dts_occurrence_effects effect
        on effect.config_revision_id = revision.id
       and effect.node_occurrence_id = node.id
       and effect.property_occurrence_id = property.id
      join public.dts_logical_node_revisions logical_revision
        on logical_revision.id = effect.logical_node_revision_id
       and logical_revision.logical_node_id = occurrence.logical_node_id
       and logical_revision.config_revision_id = revision.id
      where occurrence.id = new.source_occurrence_id
        and occurrence.organization_id = new.organization_id
        and occurrence.project_id = new.project_id
        and occurrence.occurrence_kind = 'dts'
        and occurrence.logical_node_id = new.logical_node_id
        and (select count(*) from jsonb_object_keys(new.source_locator)) = 5
        and not exists (
          select 1
          from jsonb_object_keys(new.source_locator) key_name
          where key_name not in (
            'kind', 'propertyOccurrenceId', 'nodeOccurrenceId',
            'fileVersionId', 'propertyName'
          )
        )
        and not exists (
          select 1
          from jsonb_each(new.source_locator) entry
          where jsonb_typeof(entry.value) <> 'string'
        )
        and new.parameter_locator_digest =
          parameter_catalog.canonical_dts_parameter_locator_digest(new.source_locator)
    ) into source_provenance_valid;
  else
    select exists (
      select 1
      from parameter_catalog.project_parameter_source_occurrences occurrence
      join public.project_parameter_files file
        on file.id = occurrence.file_id
       and file.organization_id = new.organization_id
       and file.project_id = new.project_id
       and file.config_set_id = occurrence.config_set_id
      join public.dts_config_revisions revision
        on revision.id = new.config_revision_id
       and revision.organization_id = new.organization_id
       and revision.project_id = new.project_id
       and revision.config_set_id = occurrence.config_set_id
      join public.dts_config_revision_members member
        on member.config_revision_id = revision.id
       and member.file_id = occurrence.file_id
       and member.file_version_id = new.source_locator ->> 'fileVersionId'
      where occurrence.id = new.source_occurrence_id
        and occurrence.organization_id = new.organization_id
        and occurrence.project_id = new.project_id
        and occurrence.occurrence_kind = 'json'
        and occurrence.logical_node_id is null
        and new.logical_node_id is null
        and (select count(*) from jsonb_object_keys(new.source_locator)) = 3
        and not exists (
          select 1
          from jsonb_object_keys(new.source_locator) key_name
          where key_name not in ('kind', 'fileVersionId', 'pointer')
        )
        and not exists (
          select 1
          from jsonb_each(new.source_locator) entry
          where jsonb_typeof(entry.value) <> 'string'
        )
        and new.parameter_locator_digest = 'sha256:' || pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(
            concat(
              '{', chr(10),
              '  "fileVersionId": ', pg_catalog.to_json(new.source_locator ->> 'fileVersionId')::text, ',', chr(10),
              '  "kind": ', pg_catalog.to_json(new.source_locator ->> 'kind')::text, ',', chr(10),
              '  "pointer": ', pg_catalog.to_json(new.source_locator ->> 'pointer')::text, chr(10),
              '}', chr(10)
            ),
            'UTF8'
          )),
          'hex'
        )
        and parameter_catalog.json_pointer_contains(
          occurrence.root_pointer,
          new.source_locator ->> 'pointer'
        )
    ) into source_provenance_valid;
  end if;

  if not source_provenance_valid then
    raise exception using
      errcode = '23503',
      message = 'Parameter observation source provenance does not prove its exact revision, member and locator',
      constraint = 'parameter_observation_source_owner_fk';
  end if;
  return null;
end;
$$;
create constraint trigger parameter_observation_source_owner_fk
after insert or update of organization_id, project_id, logical_node_id,
  config_revision_id, source_locator, source_occurrence_id, parameter_locator_digest
on parameter_catalog.parameter_observations
deferrable initially deferred
for each row execute function parameter_catalog.assert_parameter_observation_source_owner();

alter table parameter_catalog.binding_history_events
  add column if not exists applied_request_id text;
create unique index if not exists binding_history_events_applied_request_uk
  on parameter_catalog.binding_history_events (applied_request_id)
  where applied_request_id is not null;
alter table parameter_catalog.binding_history_events
  add constraint binding_history_event_applied_request_fk
  foreign key (applied_request_id)
  references public.project_parameter_value_change_requests(id)
  on delete restrict deferrable initially deferred;
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_request_history_fk
  foreign key (applied_history_event_id)
  references parameter_catalog.binding_history_events(id)
  on delete restrict deferrable initially deferred;

alter table public.project_parameter_value_change_requests
  drop constraint if exists project_parameter_value_change_requests_outcome_ck;
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_outcome_ck check (
    (status = 'approved'
      and applied_value_id is not null
      and applied_at is not null
      and apply_outcome is not null
      and applied_history_event_id is not null
      and applied_audit_ref is not null
      and jsonb_typeof(applied_file_version_ids) = 'array'
      and jsonb_typeof(applied_source_result) = 'object')
    or
    (status <> 'approved'
      and applied_value_id is null
      and applied_at is null
      and apply_outcome is null
      and applied_history_event_id is null
      and applied_audit_ref is null
      and applied_file_version_ids is null
      and applied_source_result is null)
  );

-- Compatibility resolver: zero is empty, one is exact, and ambiguity is an
-- explicit error rather than arbitrary LIMIT 1 selection.
create or replace function parameter_catalog.resolve_current_binding(
  p_project_id text,
  p_logical_node_id text,
  p_definition_id text
)
returns text
language plpgsql
stable
set search_path = pg_catalog, parameter_catalog
as $$
declare
  replacement_count integer;
  replacement_id text;
  base_count integer;
  base_id text;
begin
  select count(*)::integer, min(replacement.new_binding_id)
    into replacement_count, replacement_id
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.definition_replacement_projects replacement
    on replacement.status = 'completed'
   and replacement.old_binding_id = binding.id
  where binding.project_id = p_project_id
    and binding.logical_node_id = p_logical_node_id
    and binding.definition_id = p_definition_id;
  if replacement_count > 1 then
    raise exception using errcode = 'P0001', message = 'Ambiguous current Binding replacement';
  end if;
  if replacement_count = 1 then
    return replacement_id;
  end if;

  select count(*)::integer, min(binding.id)
    into base_count, base_id
  from parameter_catalog.project_parameter_bindings binding
  where binding.project_id = p_project_id
    and binding.logical_node_id = p_logical_node_id
    and binding.definition_id = p_definition_id
    and not exists (
      select 1
      from parameter_catalog.definition_replacement_projects replacement
      where replacement.status = 'completed'
        and replacement.old_binding_id = binding.id
    );
  if base_count > 1 then
    raise exception using errcode = 'P0001', message = 'Ambiguous current Binding identity';
  end if;
  return base_id;
end;
$$;

create or replace function parameter_catalog.resolve_current_binding_by_source_occurrence(
  p_project_id text,
  p_source_occurrence_id text,
  p_definition_id text
)
returns text
language plpgsql
stable
set search_path = pg_catalog, parameter_catalog
as $$
declare
  replacement_count integer;
  replacement_id text;
  candidate_count integer;
  candidate_id text;
begin
  -- A completed definition replacement preserves the source occurrence but
  -- projects the old Definition lookup onto its new Binding.  Keep this
  -- branch identical to resolve_current_binding so old-definition callers do
  -- not lose identity after the replacement is completed.
  select count(*)::integer, min(replacement.new_binding_id)
    into replacement_count, replacement_id
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.definition_replacement_projects replacement
    on replacement.status = 'completed'
   and replacement.old_binding_id = binding.id
  where binding.project_id = p_project_id
    and binding.source_occurrence_id = p_source_occurrence_id
    and binding.definition_id = p_definition_id;
  if replacement_count > 1 then
    raise exception using errcode = 'P0001', message = 'Ambiguous current source occurrence Binding replacement';
  end if;
  if replacement_count = 1 then
    return replacement_id;
  end if;

  select count(*)::integer, min(binding.id)
    into candidate_count, candidate_id
  from parameter_catalog.project_parameter_bindings binding
  where binding.project_id = p_project_id
    and binding.source_occurrence_id = p_source_occurrence_id
    and binding.definition_id = p_definition_id
    and not exists (
      select 1
      from parameter_catalog.definition_replacement_projects replacement
      where replacement.status = 'completed'
        and replacement.old_binding_id = binding.id
    );
  if candidate_count > 1 then
    raise exception using errcode = 'P0001', message = 'Ambiguous current source occurrence Binding';
  end if;
  return candidate_id;
end;
$$;

-- Owner-only relation/function ACL.  Existing observation/match grants are not
-- expanded; no runtime role receives direct source or Binding authority.
-- The submitted-candidate trigger is SECURITY DEFINER and reads only the two
-- public workflow relations needed to enforce payload immutability.  Keep this
-- grant to the existing NOLOGIN migration owner; it does not grant any runtime
-- synchronizer, governance or coordinator role access.
grant select on table
  public.project_parameter_file_candidates,
  public.project_parameter_value_change_requests,
  public.project_parameter_files,
  public.project_parameter_file_versions,
  public.dts_config_revision_members,
  public.dts_property_occurrences,
  public.dts_node_occurrences,
  public.dts_occurrence_effects,
  public.dts_logical_node_revisions
to catalog_migration_owner;
alter table parameter_catalog.project_parameter_source_occurrences owner to catalog_migration_owner;
alter table parameter_catalog.project_value_source_pins owner to catalog_migration_owner;
alter function parameter_catalog.normalize_dts_source_name(text) owner to catalog_migration_owner;
alter function parameter_catalog.normalize_dts_revision_member_source_name() owner to catalog_migration_owner;
alter function parameter_catalog.canonical_dts_parameter_locator_digest(jsonb) owner to catalog_migration_owner;
alter function parameter_catalog.protect_source_occurrence_identity() owner to catalog_migration_owner;
alter function parameter_catalog.json_pointer_contains(text, text) owner to catalog_migration_owner;
alter function parameter_catalog.protect_pinned_source_provenance() owner to catalog_migration_owner;
alter function parameter_catalog.assert_project_value_source_pin_owner() owner to catalog_migration_owner;
alter function parameter_catalog.reject_immutable_project_value_source_pin() owner to catalog_migration_owner;
alter function parameter_catalog.assert_binding_current_source_pin() owner to catalog_migration_owner;
alter function parameter_catalog.protect_project_parameter_binding_source_identity() owner to catalog_migration_owner;
alter function parameter_catalog.protect_submitted_candidate_payload() owner to catalog_migration_owner;
alter function parameter_catalog.protect_submitted_source_request() owner to catalog_migration_owner;
alter function parameter_catalog.assert_source_candidate_snapshot() owner to catalog_migration_owner;
alter function parameter_catalog.assert_source_apply_result() owner to catalog_migration_owner;
alter function parameter_catalog.assert_parameter_observation_source_owner() owner to catalog_migration_owner;
alter function parameter_catalog.resolve_current_binding(text, text, text) owner to catalog_migration_owner;
alter function parameter_catalog.resolve_current_binding_by_source_occurrence(text, text, text) owner to catalog_migration_owner;

revoke all on table
  parameter_catalog.project_parameter_source_occurrences,
  parameter_catalog.project_value_source_pins,
  parameter_catalog.current_project_parameter_bindings
from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;
revoke all on function
  parameter_catalog.normalize_dts_source_name(text),
  parameter_catalog.normalize_dts_revision_member_source_name(),
  parameter_catalog.canonical_dts_parameter_locator_digest(jsonb),
  parameter_catalog.protect_source_occurrence_identity(),
  parameter_catalog.json_pointer_contains(text, text),
  parameter_catalog.protect_pinned_source_provenance(),
  parameter_catalog.assert_project_value_source_pin_owner(),
  parameter_catalog.reject_immutable_project_value_source_pin(),
  parameter_catalog.assert_binding_current_source_pin(),
  parameter_catalog.protect_project_parameter_binding_source_identity(),
  parameter_catalog.protect_submitted_candidate_payload(),
  parameter_catalog.protect_submitted_source_request(),
  parameter_catalog.assert_source_candidate_snapshot(),
  parameter_catalog.assert_source_apply_result(),
  parameter_catalog.assert_parameter_observation_source_owner(),
  parameter_catalog.resolve_current_binding(text, text, text),
  parameter_catalog.resolve_current_binding_by_source_occurrence(text, text, text)
from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

alter default privileges for role catalog_migration_owner in schema parameter_catalog
  revoke all on tables from public;
alter default privileges in schema parameter_catalog
  revoke all on tables from public;
