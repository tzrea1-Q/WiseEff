-- Catalog publication runtime (CP-06).
--
-- Durable maintenance freeze is a singleton row, not a policy-revision bump,
-- so freeze does not stale existing Candidate authorizations. Direct UPDATE is
-- owner-only; coordinator/synchronizer change freeze only via
-- catalog_publication.set_publication_freeze after the publication guard.
--
-- Combo verification purpose catalog-publication-runtime is additive. Existing
-- post-retirement-runtime pin comparisons stay exact. 0140-0142 bytes are not
-- modified. This is not production enablement.

select pg_catalog.pg_advisory_lock(140014000143);

create table catalog_publication.publication_freeze (
  singleton boolean primary key default true check (singleton),
  frozen boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_principal_id text not null
    check (
      updated_by_principal_id <> ''
      and btrim(updated_by_principal_id) = updated_by_principal_id
      and updated_by_principal_id !~ '[[:cntrl:]]'
    )
);

comment on table catalog_publication.publication_freeze is
  'Durable publication freeze. Activation must fail publication-frozen while frozen=true. Closing publication_enabled does not clear this row.';

insert into catalog_publication.publication_freeze (
  singleton,
  frozen,
  updated_by_principal_id
) values (
  true,
  false,
  'catalog-migration'
);

create function catalog_publication.reject_direct_freeze_update()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog_publication
as $$
begin
  if current_user is distinct from 'catalog_migration_owner' then
    raise exception using
      errcode = '42501',
      message = 'publication freeze can only be revised via catalog_publication.set_publication_freeze';
  end if;
  return new;
end;
$$;

create trigger publication_freeze_no_delete
before delete on catalog_publication.publication_freeze
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger publication_freeze_direct_update
before update on catalog_publication.publication_freeze
for each row execute function catalog_publication.reject_direct_freeze_update();

create function catalog_publication.set_publication_freeze(
  frozen boolean,
  actor_principal_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, catalog_publication
as $$
declare
  current_frozen boolean;
begin
  if actor_principal_id is null
     or actor_principal_id = ''
     or btrim(actor_principal_id) <> actor_principal_id
     or actor_principal_id ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '23514',
      message = 'actor_principal_id must be a non-empty control-free token';
  end if;

  perform catalog_publication.acquire_publication_guard_lock();

  update catalog_publication.publication_freeze as freeze_row
  set
    frozen = set_publication_freeze.frozen,
    updated_at = now(),
    updated_by_principal_id = set_publication_freeze.actor_principal_id
  where freeze_row.singleton
  returning freeze_row.frozen into current_frozen;

  if current_frozen is null then
    raise exception using
      errcode = 'P0002',
      message = 'publication freeze singleton is missing';
  end if;

  return current_frozen;
end;
$$;

comment on function catalog_publication.set_publication_freeze(boolean, text) is
  'Coordinator-callable SECURITY DEFINER freeze/unfreeze. Takes publication_guard then updates the singleton freeze row. Does not bump publication_policies.revision.';

-- Purpose CHECKs live on parameter_catalog verification relations (0139).
alter table parameter_catalog.verification_plans
  drop constraint verification_plans_purpose_check;
alter table parameter_catalog.verification_plans
  add constraint verification_plans_purpose_check check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup',
    'catalog-publication-runtime'
  ));

alter table parameter_catalog.verification_attempts
  drop constraint verification_attempts_purpose_check;
alter table parameter_catalog.verification_attempts
  add constraint verification_attempts_purpose_check check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup',
    'catalog-publication-runtime'
  ));

alter table parameter_catalog.verification_gate_results
  drop constraint verification_gate_results_successor_purpose_check;
alter table parameter_catalog.verification_gate_results
  add constraint verification_gate_results_successor_purpose_check check (
    successor_purpose is null or successor_purpose in (
      'pre-activation',
      'post-retirement-runtime',
      'isolated-candidate-acceptance',
      'public-release',
      'legacy-read-sunset',
      'p16-cleanup',
      'catalog-publication-runtime'
    )
  );

alter table parameter_catalog.verification_reports
  drop constraint verification_reports_purpose_check;
alter table parameter_catalog.verification_reports
  add constraint verification_reports_purpose_check check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup',
    'catalog-publication-runtime'
  ));

alter table parameter_catalog.verification_approvals
  drop constraint verification_approvals_purpose_check;
alter table parameter_catalog.verification_approvals
  add constraint verification_approvals_purpose_check check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup',
    'catalog-publication-runtime'
  ));

do $$
declare
  obj record;
begin
  for obj in
    select class.relkind, format('%I.%I', namespace.nspname, class.relname) as object_id
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'catalog_publication'
      and class.relname = 'publication_freeze'
  loop
    execute format('alter table %s owner to catalog_migration_owner', obj.object_id);
  end loop;

  execute 'alter function catalog_publication.reject_direct_freeze_update() owner to catalog_migration_owner';
  execute 'alter function catalog_publication.set_publication_freeze(boolean, text) owner to catalog_migration_owner';
end;
$$;

revoke all on table catalog_publication.publication_freeze
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

revoke all on function catalog_publication.reject_direct_freeze_update()
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

revoke all on function catalog_publication.set_publication_freeze(boolean, text)
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

grant select on table catalog_publication.publication_freeze
  to catalog_publication_coordinator_role, catalog_synchronizer_role, catalog_baseline_reader_role;

grant execute on function catalog_publication.set_publication_freeze(boolean, text)
  to catalog_publication_coordinator_role;

select pg_catalog.pg_advisory_unlock(140014000143);
