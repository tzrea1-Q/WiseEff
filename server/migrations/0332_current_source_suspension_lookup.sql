-- Keep the bounded read RPC and its existing owner/ACL. PostgreSQL 16 SQL
-- functions plan the nested evidence query even when no receipt can match.
-- First enumerate the exact current-tip candidates using a cached PL/pgSQL
-- statement; only prepare/evaluate the expensive proof path when one exists.
-- This caches plans, never suspension results: every call reads its snapshot.
create or replace function parameter_catalog.current_source_binding_is_suspended(p_org text,p_project text,p_binding text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare candidate record;
begin
  for candidate in
    select receipt.request_id,binding.id,binding.current_value_id,
      receipt.source_pin_id,receipt.applied_config_revision_id
    from parameter_catalog.project_parameter_bindings binding
    join parameter_catalog.source_binding_suspension_receipts receipt on receipt.binding_id=binding.id
      and receipt.organization_id=binding.organization_id and receipt.project_id=binding.project_id
      and receipt.definition_id=binding.definition_id and receipt.old_value_id=binding.current_value_id
    where binding.id=p_binding and binding.organization_id=p_org and binding.project_id=p_project
  loop
    if parameter_catalog.source_revision_exclusion_matches(candidate.request_id,candidate.id,
      candidate.current_value_id,candidate.source_pin_id,candidate.applied_config_revision_id) then
      return true;
    end if;
  end loop;
  return false;
end
$$;
