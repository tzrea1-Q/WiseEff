-- #849/#853: completed replacements preserve their source root; JSON root
-- digests are exact immutable UTF-8 identity. The runner owns the transaction.
lock table parameter_catalog.project_parameter_source_occurrences,
  parameter_catalog.project_parameter_bindings,
  parameter_catalog.definition_replacement_projects in share row exclusive mode;

-- Do not repair or reinterpret historical completed edges during an upgrade.
do $$
begin
  if exists (
    select 1 from parameter_catalog.definition_replacement_projects replacement
    left join parameter_catalog.project_parameter_bindings predecessor
      on predecessor.id = replacement.old_binding_id
    left join parameter_catalog.project_parameter_bindings successor
      on successor.id = replacement.new_binding_id
    where replacement.status = 'completed'
      and (predecessor.id is null or successor.id is null
        or predecessor.source_occurrence_id is null
        or successor.source_occurrence_id is distinct from predecessor.source_occurrence_id
        or predecessor.organization_id is distinct from replacement.organization_id
        or predecessor.project_id is distinct from replacement.project_id
        or successor.organization_id is distinct from replacement.organization_id
        or successor.project_id is distinct from replacement.project_id)
  ) then
    raise exception using errcode = '23514',
      message = '0153 cannot prove completed replacement source occurrence identity';
  end if;
end;
$$;

alter table parameter_catalog.project_parameter_source_occurrences
  add constraint project_parameter_source_occurrence_root_digest_ck
  check (occurrence_kind <> 'json' or root_pointer_digest =
    'sha256:' || encode(sha256(convert_to(root_pointer, 'UTF8')), 'hex'));

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
     or new.root_pointer is distinct from old.root_pointer
     or new.root_pointer_digest is distinct from old.root_pointer_digest then
    raise exception using errcode = '55000', message = 'Source occurrence identity is immutable';
  end if;
  return new;
end;
$$;

create function parameter_catalog.assert_replacement_source_occurrence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  -- Deferred events must inspect the final row, not an earlier NEW projection.
  if exists (
    select 1 from parameter_catalog.definition_replacement_projects replacement
    left join parameter_catalog.project_parameter_bindings predecessor
      on predecessor.id = replacement.old_binding_id
    left join parameter_catalog.project_parameter_bindings successor
      on successor.id = replacement.new_binding_id
    where replacement.id = new.id and replacement.status = 'completed'
      and (predecessor.id is null or successor.id is null
        or predecessor.source_occurrence_id is null
        or successor.source_occurrence_id is distinct from predecessor.source_occurrence_id
        or predecessor.organization_id is distinct from replacement.organization_id
        or predecessor.project_id is distinct from replacement.project_id
        or successor.organization_id is distinct from replacement.organization_id
        or successor.project_id is distinct from replacement.project_id)
  ) then
    raise exception using errcode = '23514',
      message = 'Completed replacement must preserve its owned source occurrence';
  end if;
  return null;
end;
$$;
create constraint trigger definition_replacement_source_occurrence_ck
after insert or update on parameter_catalog.definition_replacement_projects
deferrable initially deferred
for each row execute function parameter_catalog.assert_replacement_source_occurrence();

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
  invalid_source boolean;
  base_count integer;
  base_id text;
begin
  select count(*)::integer, min(replacement.new_binding_id),
    bool_or(target.id is null
      or binding.source_occurrence_id is null
      or target.source_occurrence_id is distinct from binding.source_occurrence_id
      or binding.organization_id is distinct from replacement.organization_id
      or binding.project_id is distinct from replacement.project_id
      or target.organization_id is distinct from replacement.organization_id
      or target.project_id is distinct from replacement.project_id)
    into replacement_count, replacement_id, invalid_source
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.definition_replacement_projects replacement
    on replacement.status = 'completed'
   and replacement.old_binding_id = binding.id
  left join parameter_catalog.project_parameter_bindings target
    on target.id = replacement.new_binding_id
  where binding.project_id = p_project_id
    and binding.logical_node_id = p_logical_node_id
    and binding.definition_id = p_definition_id;
  if invalid_source then
    raise exception using errcode = '23514', message = 'Completed replacement must preserve its owned source occurrence';
  end if;
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
  invalid_source boolean;
  candidate_count integer;
  candidate_id text;
begin
  -- A completed definition replacement preserves the source occurrence but
  -- projects the old Definition lookup onto its new Binding.  Keep this
  -- branch identical to resolve_current_binding so old-definition callers do
  -- not lose identity after the replacement is completed.
  select count(*)::integer, min(replacement.new_binding_id),
    bool_or(target.id is null
      or binding.source_occurrence_id is null
      or target.source_occurrence_id is distinct from binding.source_occurrence_id
      or binding.organization_id is distinct from replacement.organization_id
      or binding.project_id is distinct from replacement.project_id
      or target.organization_id is distinct from replacement.organization_id
      or target.project_id is distinct from replacement.project_id)
    into replacement_count, replacement_id, invalid_source
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.definition_replacement_projects replacement
    on replacement.status = 'completed'
   and replacement.old_binding_id = binding.id
  left join parameter_catalog.project_parameter_bindings target
    on target.id = replacement.new_binding_id
  where binding.project_id = p_project_id
    and binding.source_occurrence_id = p_source_occurrence_id
    and binding.definition_id = p_definition_id;
  if invalid_source then
    raise exception using errcode = '23514', message = 'Completed replacement must preserve its owned source occurrence';
  end if;
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

alter function parameter_catalog.assert_replacement_source_occurrence() owner to catalog_migration_owner;
-- CREATE OR REPLACE preserves the existing owners and ACLs; explicitly keep
-- these entry points owner-only, including the new SECURITY DEFINER trigger.
revoke all on function
  parameter_catalog.assert_replacement_source_occurrence(),
  parameter_catalog.protect_source_occurrence_identity(),
  parameter_catalog.resolve_current_binding(text, text, text),
  parameter_catalog.resolve_current_binding_by_source_occurrence(text, text, text)
from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

