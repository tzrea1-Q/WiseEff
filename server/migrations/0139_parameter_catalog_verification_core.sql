-- Wayfinder #668 / Issue #714 (S10-PER): verification plans, attempts, and closed gate registry.
-- Append-only purpose-scoped persistence for Release Verification. Callers cannot
-- store a waiver or a self-selected gate list; the registry is closed.

select pg_catalog.pg_advisory_lock(714013900139);

create table parameter_catalog.verification_gate_registry (
  gate_id text primary key
    check (gate_id <> '' and btrim(gate_id) = gate_id and gate_id !~ '[[:cntrl:]]'),
  family text not null check (family in (
    'database',
    'migration',
    'privilege',
    'comparison',
    'api',
    'browser',
    'recovery',
    'writer',
    'observability',
    'rollback',
    'runtime-pin',
    'lineage',
    'retirement',
    'restore'
  )),
  created_at timestamptz not null default now()
);

insert into parameter_catalog.verification_gate_registry (gate_id, family)
select 'PCAT-DB-V' || lpad(n::text, 2, '0'), 'database'
from generate_series(1, 17) as n;

insert into parameter_catalog.verification_gate_registry (gate_id, family)
select 'PCAT-DB-M' || lpad(n::text, 2, '0'), 'migration'
from generate_series(1, 4) as n;

insert into parameter_catalog.verification_gate_registry (gate_id, family)
select 'PCAT-DB-P' || lpad(n::text, 2, '0'), 'privilege'
from generate_series(1, 2) as n;

insert into parameter_catalog.verification_gate_registry (gate_id, family)
select 'PCAT-CMP-D' || lpad(n::text, 2, '0'), 'comparison'
from generate_series(1, 9) as n;

insert into parameter_catalog.verification_gate_registry (gate_id, family)
select 'PCAT-API-' || lpad(n::text, 2, '0'), 'api'
from generate_series(1, 12) as n;

insert into parameter_catalog.verification_gate_registry (gate_id, family)
select 'PCAT-UI-' || lpad(n::text, 2, '0'), 'browser'
from generate_series(1, 15) as n;

insert into parameter_catalog.verification_gate_registry (gate_id, family)
values
  ('PCAT-RP-RECOVERY-POINT', 'recovery'),
  ('PCAT-WRITER-PRE-SWITCH-FENCE', 'writer'),
  ('PCAT-OBS-INTERNAL', 'observability'),
  ('PCAT-RB-POINTER-CLOSURE', 'rollback'),
  ('PCAT-UPG-RUNTIME-PIN', 'runtime-pin'),
  ('PCAT-LINEAGE-PREDECESSOR-DIGESTS', 'lineage'),
  ('PCAT-RET-COMPAT-WINDOW', 'retirement'),
  ('PCAT-RET-CONSUMER-DISPOSITION', 'retirement'),
  ('PCAT-RET-ZERO-DEPENDENCY', 'retirement'),
  ('PCAT-RESTORE-REHEARSAL', 'restore'),
  ('PCAT-RET-LEGAL-HOLD', 'retirement');

create table parameter_catalog.verification_plans (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  digest text not null unique check (digest ~ '^sha256:[0-9a-f]{64}$'),
  canonical_bytes text not null check (canonical_bytes <> ''),
  purpose text not null check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup'
  )),
  mode text not null check (mode in ('fresh', 'populated', 'restored', 'cleanup')),
  subject_key text not null check (subject_key <> '' and btrim(subject_key) = subject_key),
  subject jsonb not null check (jsonb_typeof(subject) = 'object'),
  lineage jsonb not null check (jsonb_typeof(lineage) = 'object'),
  pins jsonb not null check (jsonb_typeof(pins) = 'object'),
  evidence_requirements jsonb not null check (jsonb_typeof(evidence_requirements) = 'object'),
  registry_digest text not null check (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  applicability_profile jsonb not null check (jsonb_typeof(applicability_profile) = 'array'),
  created_at timestamptz not null default now(),
  check (evidence_requirements ?& array[
    'recoveryPointDigest',
    'mappingEpoch',
    'cutoverPlanDigest',
    'acceptanceContractDigest'
  ]),
  check (not (evidence_requirements ?| array[
    'gates',
    'gateIds',
    'gateList',
    'gateSelection',
    'waiver',
    'waive',
    'waived',
    'skip',
    'skipped',
    'skippedAsWaived'
  ]))
);

create table parameter_catalog.verification_attempts (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  digest text not null check (digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_id text not null references parameter_catalog.verification_plans(id) on delete restrict,
  plan_digest text not null check (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  purpose text not null check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup'
  )),
  created_at timestamptz not null default now()
);

create index verification_attempts_plan_digest_idx
  on parameter_catalog.verification_attempts (plan_digest, created_at desc);

create table parameter_catalog.verification_gate_results (
  attempt_id text not null references parameter_catalog.verification_attempts(id) on delete restrict,
  gate_id text not null references parameter_catalog.verification_gate_registry(gate_id) on delete restrict,
  status text not null check (status in (
    'passed',
    'failed',
    'not-yet-executable',
    'not-applicable'
  )),
  failure_code text,
  evidence_digest text,
  successor_purpose text check (
    successor_purpose is null or successor_purpose in (
      'pre-activation',
      'post-retirement-runtime',
      'isolated-candidate-acceptance',
      'public-release',
      'legacy-read-sunset',
      'p16-cleanup'
    )
  ),
  not_applicable_proof text,
  created_at timestamptz not null default now(),
  primary key (attempt_id, gate_id),
  check (status <> 'waived' and status <> 'skipped' and status <> 'skipped-as-waived')
);

create table parameter_catalog.verification_reports (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  digest text not null unique check (digest ~ '^sha256:[0-9a-f]{64}$'),
  canonical_bytes text not null check (canonical_bytes <> ''),
  plan_id text not null references parameter_catalog.verification_plans(id) on delete restrict,
  plan_digest text not null check (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  attempt_id text not null unique references parameter_catalog.verification_attempts(id) on delete restrict,
  attempt_digest text not null check (attempt_digest ~ '^sha256:[0-9a-f]{64}$'),
  purpose text not null check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup'
  )),
  mode text not null check (mode in ('fresh', 'populated', 'restored', 'cleanup')),
  decision text not null check (decision in ('passed', 'blocked')),
  results jsonb not null check (jsonb_typeof(results) = 'array'),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array'),
  registry_digest text not null check (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  assembled_at timestamptz not null default now()
);

create table parameter_catalog.verification_approvals (
  id text primary key check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  report_id text not null references parameter_catalog.verification_reports(id) on delete restrict,
  report_digest text not null check (report_digest ~ '^sha256:[0-9a-f]{64}$'),
  purpose text not null check (purpose in (
    'pre-activation',
    'post-retirement-runtime',
    'isolated-candidate-acceptance',
    'public-release',
    'legacy-read-sunset',
    'p16-cleanup'
  )),
  principal_kind text not null check (principal_kind in ('operator', 'platform-owner')),
  principal_id text not null check (principal_id <> '' and btrim(principal_id) = principal_id),
  approved_at timestamptz not null default now(),
  unique (report_id, principal_kind)
);

create function parameter_catalog.assert_verification_approval_principals()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if exists (
    select 1
    from parameter_catalog.verification_approvals existing
    where existing.report_id = new.report_id
      and existing.principal_id = new.principal_id
      and existing.principal_kind is distinct from new.principal_kind
  ) then
    raise exception using
      errcode = '23514',
      message = 'operator and platform-owner approvals must be distinct principals';
  end if;
  return new;
end;
$$;

create trigger verification_approval_distinct_principals
before insert on parameter_catalog.verification_approvals
for each row execute function parameter_catalog.assert_verification_approval_principals();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'verification_gate_registry',
    'verification_plans',
    'verification_attempts',
    'verification_gate_results',
    'verification_reports',
    'verification_approvals'
  ] loop
    execute format(
      'create trigger %I before update or delete on parameter_catalog.%I for each row execute function parameter_catalog.reject_immutable_catalog_change()',
      relation_name || '_immutable',
      relation_name
    );
  end loop;
end;
$$;

do $$
declare
  obj record;
begin
  for obj in
    select class.relkind, format('%I.%I', namespace.nspname, class.relname) as object_id
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'parameter_catalog'
      and class.relname like 'verification_%'
      and class.relkind in ('r', 'p', 'S')
  loop
    execute format('alter table %s owner to catalog_migration_owner', obj.object_id);
  end loop;

  for obj in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    ) as object_id
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'parameter_catalog'
      and procedure.proname = 'assert_verification_approval_principals'
  loop
    execute format('alter function %s owner to catalog_migration_owner', obj.object_id);
    execute format('revoke all on function %s from public', obj.object_id);
    execute format('revoke all on function %s from catalog_synchronizer_role', obj.object_id);
    execute format('revoke all on function %s from parameter_governance_writer_role', obj.object_id);
  end loop;
end;
$$;

revoke all on table
  parameter_catalog.verification_gate_registry,
  parameter_catalog.verification_plans,
  parameter_catalog.verification_attempts,
  parameter_catalog.verification_gate_results,
  parameter_catalog.verification_reports,
  parameter_catalog.verification_approvals
from public, catalog_synchronizer_role, parameter_governance_writer_role;

select pg_catalog.pg_advisory_unlock(714013900139);
