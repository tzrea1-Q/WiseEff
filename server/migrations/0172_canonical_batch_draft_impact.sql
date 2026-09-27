-- #906 C: freeze the full source cohort's draft impact alongside the existing
-- single batch request. Older pending requests have no proof and fail closed at
-- the C review entry; their rejection and withdrawal remain available.
alter table public.project_parameter_value_change_requests
  add column batch_draft_impact jsonb,
  add column batch_draft_impact_digest text;

alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_draft_impact_ck check (
    (batch_draft_impact is null and batch_draft_impact_digest is null)
    or (request_kind = 'batch' and jsonb_typeof(batch_draft_impact) = 'array'
      and batch_draft_impact_digest ~ '^[0-9a-f]{64}$')
  );

create function parameter_catalog.protect_batch_draft_impact()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if new.batch_draft_impact is distinct from old.batch_draft_impact
     or new.batch_draft_impact_digest is distinct from old.batch_draft_impact_digest then
    raise exception using errcode = '55000', message = 'Frozen batch draft impact is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_value_change_request_draft_impact_immutable
before update on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.protect_batch_draft_impact();
alter function parameter_catalog.protect_batch_draft_impact()
  owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_batch_draft_impact()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
