-- Keep ordinary identity replacements occurrence-preserving. A merge between
-- distinct occurrences is a historical edge, allowed only after source owners
-- committed the removal and the surviving pinned value matches the frozen choice.
create function parameter_catalog.is_reviewed_definition_merge(edge parameter_catalog.definition_replacement_projects)
returns boolean
language sql
stable
set search_path = pg_catalog, parameter_catalog
as $$
  select exists (
    select 1
    from parameter_catalog.definition_replacements parent
    cross join lateral jsonb_array_elements(parent.frozen_manifest) tip
    join parameter_catalog.project_parameter_values original_source
      on original_source.id=edge.old_value_id and original_source.binding_id=edge.old_binding_id
    join parameter_catalog.project_parameter_values original_target
      on original_target.id=tip->'mergeConflict'->>'targetValueId' and original_target.binding_id=edge.new_binding_id
    join parameter_catalog.project_parameter_values final_target
      on final_target.id=edge.new_value_id and final_target.binding_id=edge.new_binding_id and final_target.value_state='present'
    join parameter_catalog.project_value_source_pins target_pin
      on target_pin.project_value_id=final_target.id and target_pin.binding_id=edge.new_binding_id
    join parameter_catalog.project_parameter_bindings source on source.id=edge.old_binding_id
    join parameter_catalog.project_parameter_values removed
      on removed.id=source.current_value_id and removed.binding_id=source.id and removed.value_state='deleted'
    join parameter_catalog.project_value_source_pins removal
      on removal.project_value_id=removed.id and removal.binding_id=source.id and removal.value_state='deleted'
    join public.project_parameter_value_change_requests request
      on request.id=removal.delete_request_id and request.organization_id=edge.organization_id and request.project_id=edge.project_id
      and request.status='approved' and request.apply_outcome='committed'
    where parent.id=edge.replacement_id and parent.organization_id=edge.organization_id and parent.candidate_id is null
      and tip->>'projectId'=edge.project_id and tip->>'bindingId'=edge.old_binding_id and tip->>'currentValueId'=edge.old_value_id
      and tip->'mergeConflict'->>'targetBindingId'=edge.new_binding_id
      and jsonb_typeof(tip->'mergeConflict'->'targetUpdateRequired')='boolean'
      and removed.value_digest=original_source.value_digest
      and final_target.value_digest=case tip->'mergeConflict'->>'choice'
        when 'source' then original_source.value_digest when 'target' then original_target.value_digest end
  )
$$;

alter function parameter_catalog.is_reviewed_definition_merge(parameter_catalog.definition_replacement_projects) owner to catalog_migration_owner;
revoke all on function parameter_catalog.is_reviewed_definition_merge(parameter_catalog.definition_replacement_projects) from public;

create or replace function parameter_catalog.assert_replacement_source_occurrence()
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
        or successor.source_occurrence_id is null
        or (successor.source_occurrence_id is distinct from predecessor.source_occurrence_id
          and not parameter_catalog.is_reviewed_definition_merge(replacement))
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
    and binding.definition_id = p_definition_id
    and not (target.source_occurrence_id is distinct from binding.source_occurrence_id and exists (
      select 1 from parameter_catalog.definition_replacements parent
      cross join lateral jsonb_array_elements(parent.frozen_manifest) tip
      join parameter_catalog.project_parameter_values removed
        on removed.id=binding.current_value_id and removed.binding_id=binding.id and removed.value_state='deleted'
      where parent.id=replacement.replacement_id and parent.candidate_id is null
        and tip->>'projectId'=replacement.project_id and tip->>'bindingId'=binding.id
        and tip->'mergeConflict'->>'targetBindingId'=target.id
        and jsonb_typeof(tip->'mergeConflict'->'targetUpdateRequired')='boolean'
    ));
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
  -- A reviewed merge is a historical edge between two sources. An exact
  -- occurrence lookup must never redirect to another source instance.
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
    and binding.definition_id = p_definition_id
    and not (target.source_occurrence_id is distinct from binding.source_occurrence_id and exists (
      select 1 from parameter_catalog.definition_replacements parent
      cross join lateral jsonb_array_elements(parent.frozen_manifest) tip
      join parameter_catalog.project_parameter_values removed
        on removed.id=binding.current_value_id and removed.binding_id=binding.id and removed.value_state='deleted'
      where parent.id=replacement.replacement_id and parent.candidate_id is null
        and tip->>'projectId'=replacement.project_id and tip->>'bindingId'=binding.id
        and tip->'mergeConflict'->>'targetBindingId'=target.id
        and jsonb_typeof(tip->'mergeConflict'->'targetUpdateRequired')='boolean'
    ));
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
