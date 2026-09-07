-- P12 management persistence. P5 catalog_state remains the installed release pointer.
-- No application capabilities or historical migration contracts change here.
create table parameter_catalog.cutover_mapping_epochs (
  epoch_digest text primary key check (epoch_digest ~ '^sha256:[0-9a-f]{64}$'),
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  created_at timestamptz not null default now()
);

create table parameter_catalog.cutover_activation_attempts (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  cutover_run_id text not null references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  report_digest text not null references parameter_catalog.verification_reports(digest) on delete restrict,
  epoch_digest text not null references parameter_catalog.cutover_mapping_epochs(epoch_digest) on delete restrict,
  request_digest text not null check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_generation bigint not null check (expected_generation >= 0),
  state text not null check (state in ('pending', 'applied', 'refused')),
  refusal_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((state = 'pending' and finished_at is null and refusal_code is null)
    or (state = 'applied' and finished_at is not null and refusal_code is null)
    or (state = 'refused' and finished_at is not null and refusal_code is not null))
);
create unique index cutover_activation_one_pending_run
  on parameter_catalog.cutover_activation_attempts(cutover_run_id) where state = 'pending';

create table parameter_catalog.application_read_state (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('legacy', 'canonical')),
  generation bigint not null check (generation >= 0),
  activation_attempt_id text unique references parameter_catalog.cutover_activation_attempts(id) on delete restrict,
  binding jsonb,
  activated_at timestamptz,
  check ((mode = 'legacy' and generation = 0 and activation_attempt_id is null and binding is null and activated_at is null)
    or (mode = 'canonical' and generation > 0 and activation_attempt_id is not null
      and binding is not null and jsonb_typeof(binding) = 'object' and activated_at is not null))
);
insert into parameter_catalog.application_read_state(singleton, mode, generation) values(true, 'legacy', 0);

alter table parameter_catalog.cutover_mapping_epochs owner to catalog_migration_owner;
alter table parameter_catalog.cutover_activation_attempts owner to catalog_migration_owner;
alter table parameter_catalog.application_read_state owner to catalog_migration_owner;
revoke all on parameter_catalog.cutover_mapping_epochs from public, catalog_synchronizer_role, parameter_governance_writer_role, catalog_verifier_role, catalog_verification_writer_role, catalog_runtime_reader_role;
revoke all on parameter_catalog.cutover_activation_attempts from public, catalog_synchronizer_role, parameter_governance_writer_role, catalog_verifier_role, catalog_verification_writer_role, catalog_runtime_reader_role;
revoke all on parameter_catalog.application_read_state from public, catalog_synchronizer_role, parameter_governance_writer_role, catalog_verifier_role, catalog_verification_writer_role, catalog_runtime_reader_role;

-- An installing login's preexisting default ACL must not expose these objects.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) acl
    where c.oid = any(array['parameter_catalog.cutover_mapping_epochs'::regclass,
      'parameter_catalog.cutover_activation_attempts'::regclass,'parameter_catalog.application_read_state'::regclass])
      and acl.grantee <> c.relowner
  ) then raise exception 'P12 management object ACL drift'; end if;
end
$$;
