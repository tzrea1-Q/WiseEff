-- Catalog publication control plane (CP-02).
--
-- Physical schema catalog_publication holds Artifact, Candidate, Authorization,
-- Job, Policy, and the publication guard. Activation receipts live in
-- parameter_catalog and are insert-only for catalog_synchronizer_role.
--
-- This is not production enablement. The seeded policy row keeps
-- publication_enabled=false and low_risk_single_actor_publish=false.
-- Ordinary web/API is a LOGIN with no catalog or publication write grants;
-- this codebase has no application_role, so tests map "ordinary web" to that
-- CONNECT-only LOGIN and separately to parameter_governance_writer_role.
--
-- Grant manifest (database-local ACLs; roles themselves are cluster-global):
--   catalog_migration_owner (NOLOGIN)
--     owns catalog_publication and every relation/function in it
--     owns parameter_catalog.catalog_activation_receipts
--     owns SECURITY DEFINER revise_publication_policy (EXECUTE not granted
--       to coordinator; CP-04/12 may grant later) and
--       acquire_publication_guard_lock
--   catalog_publication_coordinator_role (NOLOGIN)
--     USAGE on catalog_publication and parameter_catalog
--     SELECT on publication relations and activation receipts
--     INSERT on artifacts, candidates, authorizations, jobs
--     UPDATE only publication_jobs execution columns
--     UPDATE on publication_guard
--     EXECUTE acquire_publication_guard_lock
--     no EXECUTE revise_publication_policy (CP-04/12; owner-only until then)
--     no Catalog core DML, no receipt INSERT/UPDATE/DELETE
--     no SET ROLE to catalog_synchronizer_role or catalog_migration_owner
--   catalog_synchronizer_role (NOLOGIN)
--     existing Catalog grants unchanged
--     INSERT, SELECT on catalog_activation_receipts
--     SELECT on publication relations needed to verify tuples
--     UPDATE on publication_guard
--     EXECUTE acquire_publication_guard_lock
--     no INSERT on artifacts/candidates/jobs/authorizations
--     no EXECUTE revise_publication_policy
--   catalog_baseline_reader_role (NOLOGIN)
--     USAGE on parameter_catalog and catalog_publication
--     SELECT on Catalog core relations, receipts, and publication relations
--     no INSERT/UPDATE/DELETE/TRUNCATE/EXECUTE of writers
--   parameter_governance_writer_role
--     no publication schema DML and no receipts
--   PUBLIC remains revoked on the new schema, tables, sequences, and functions
--
-- Lock protocol for CP-04/05 (do not GRANT UPDATE on insert-only history
-- just to SELECT FOR UPDATE):
--   1. Catalog exclusive lock remains
--      parameter_catalog.acquire_current_pointer_lock_exclusive()
--   2. Publication linearization lock is catalog_publication.publication_guard
--      (SELECT FOR UPDATE or acquire_publication_guard_lock())
--   3. Job claim updates publication_jobs execution columns only
--   4. Authorization/artifact/candidate rows stay insert-only
-- Predecessor pins on release_artifacts are stored without FK to
-- parameter_catalog.catalog_releases so an Artifact may pin a predecessor
-- before that release row exists. Target release pins also have no FK
-- because the Artifact exists before materialization.

select pg_catalog.pg_advisory_lock(140014000140);

create extension if not exists pgcrypto;

do $$
declare
  attempt integer;
  role_name text;
  role_comment text;
begin
  for attempt in 1..20 loop
    begin
      foreach role_name in array array[
        'catalog_publication_coordinator_role',
        'catalog_baseline_reader_role'
      ] loop
        if not exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
          execute format(
            'create role %I nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
            role_name
          );
        elsif exists (
          select 1
          from pg_catalog.pg_roles
          where rolname = role_name
            and (
              rolcanlogin or rolsuper or rolcreatedb or rolcreaterole
              or rolinherit or rolreplication or rolbypassrls
            )
        ) then
          execute format(
            'alter role %I with nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
            role_name
          );
        end if;

        if pg_catalog.pg_has_role(current_user, role_name, 'member') then
          execute format('revoke %I from current_user', role_name);
        end if;
      end loop;

      foreach role_comment in array array[
        'catalog_publication_coordinator_role|NOLOGIN Catalog publication coordinator: insert artifacts, candidates, authorizations, and jobs; column-limited job execution updates; cannot write Catalog core or receipts.',
        'catalog_baseline_reader_role|NOLOGIN Catalog baseline reader: SELECT on Catalog and publication relations only.'
      ] loop
        role_name := split_part(role_comment, '|', 1);
        if coalesce(shobj_description(to_regrole(role_name), 'pg_authid'), '')
             is distinct from split_part(role_comment, '|', 2) then
          execute format('comment on role %I is %L', role_name, split_part(role_comment, '|', 2));
        end if;
      end loop;

      exit;
    exception
      when duplicate_object then
        null;
      when others then
        if sqlerrm like '%tuple concurrently updated%' and attempt < 20 then
          perform pg_catalog.pg_sleep(0.05 * attempt);
        else
          raise;
        end if;
    end;
  end loop;
end;
$$;

create schema catalog_publication;
alter schema catalog_publication owner to catalog_migration_owner;
revoke all on schema catalog_publication from public;

alter table parameter_catalog.catalog_releases
  add constraint catalog_releases_id_release_digest_unique
  unique (id, release_digest);

create function catalog_publication.reject_immutable_publication_change()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog_publication
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
end;
$$;

create function catalog_publication.reject_publication_job_identity_change()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog_publication
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'catalog_publication.publication_jobs identity is immutable';
  end if;

  if new.id is distinct from old.id
     or new.candidate_id is distinct from old.candidate_id
     or new.authorization_id is distinct from old.authorization_id
     or new.request_scope is distinct from old.request_scope
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_digest is distinct from old.request_digest
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'catalog_publication.publication_jobs identity columns are immutable';
  end if;

  if new.fencing_token < old.fencing_token then
    raise exception using
      errcode = '23514',
      message = 'publication job fencing_token must be monotonic',
      constraint = 'publication_job_fencing_token_monotonic_ck';
  end if;

  return new;
end;
$$;

create function catalog_publication.digest_jsonb(value jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public
return 'sha256:' || encode(digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex');

create function catalog_publication.assert_authorization_revoke_tuple()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog_publication
as $$
declare
  candidate_artifact_digest text;
  candidate_base_id text;
  candidate_base_digest text;
  candidate_proposal_revision_id text;
  candidate_impact_digest text;
  candidate_capability_digest text;
  approved_kind text;
  approved_candidate_id text;
  approved_artifact_digest text;
  approved_base_id text;
  approved_base_digest text;
  approved_proposal_revision_id text;
  approved_impact_digest text;
  approved_capability_digest text;
  approved_policy_revision bigint;
begin
  select
    artifact_digest,
    expected_base_release_id,
    expected_base_release_digest,
    proposal_revision_id,
    impact_report_digest,
    catalog_publication.digest_jsonb(capability_contract)
  into
    candidate_artifact_digest,
    candidate_base_id,
    candidate_base_digest,
    candidate_proposal_revision_id,
    candidate_impact_digest,
    candidate_capability_digest
  from catalog_publication.candidates
  where id = new.candidate_id;

  if not found
     or candidate_artifact_digest is distinct from new.artifact_digest
     or candidate_base_id is distinct from new.expected_base_release_id
     or candidate_base_digest is distinct from new.expected_base_release_digest
     or candidate_proposal_revision_id is distinct from new.proposal_revision_id
     or candidate_impact_digest is distinct from new.impact_report_digest
     or candidate_capability_digest is distinct from new.capability_contract_digest then
    raise exception using
      errcode = '23514',
      message = 'publication authorization tuple must equal the candidate',
      constraint = 'publication_authorization_candidate_tuple_ck';
  end if;

  if new.event_kind <> 'revoke' then
    return new;
  end if;

  select
    event_kind,
    candidate_id,
    artifact_digest,
    expected_base_release_id,
    expected_base_release_digest,
    proposal_revision_id,
    impact_report_digest,
    capability_contract_digest,
    policy_revision
  into
    approved_kind,
    approved_candidate_id,
    approved_artifact_digest,
    approved_base_id,
    approved_base_digest,
    approved_proposal_revision_id,
    approved_impact_digest,
    approved_capability_digest,
    approved_policy_revision
  from catalog_publication.publication_authorizations
  where id = new.approved_authorization_id;

  if not found or approved_kind <> 'approve' then
    raise exception using
      errcode = '23514',
      message = 'publication revoke must reference an approve authorization',
      constraint = 'publication_authorization_revoke_approve_ck';
  end if;

  if approved_candidate_id is distinct from new.candidate_id
     or approved_artifact_digest is distinct from new.artifact_digest
     or approved_base_id is distinct from new.expected_base_release_id
     or approved_base_digest is distinct from new.expected_base_release_digest
     or approved_proposal_revision_id is distinct from new.proposal_revision_id
     or approved_impact_digest is distinct from new.impact_report_digest
     or approved_capability_digest is distinct from new.capability_contract_digest
     or approved_policy_revision is distinct from new.policy_revision then
    raise exception using
      errcode = '23514',
      message = 'publication revoke tuple must equal the referenced approve row',
      constraint = 'publication_authorization_revoke_tuple_ck';
  end if;

  return new;
end;
$$;

create function catalog_publication.assert_job_authorization_approve()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog_publication
as $$
declare
  authorization_kind text;
begin
  select event_kind into authorization_kind
  from catalog_publication.publication_authorizations
  where id = new.authorization_id;

  if authorization_kind is distinct from 'approve' then
    raise exception using
      errcode = '23514',
      message = 'publication job authorization must be an approve event',
      constraint = 'publication_job_authorization_approve_ck';
  end if;

  return new;
end;
$$;

create function catalog_publication.reject_direct_policy_update()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog_publication
as $$
begin
  if current_user is distinct from 'catalog_migration_owner' then
    raise exception using
      errcode = '42501',
      message = 'publication policy can only be revised via catalog_publication.revise_publication_policy';
  end if;
  return new;
end;
$$;

create function catalog_publication.revise_publication_policy(
  publication_enabled boolean,
  low_risk_single_actor_publish boolean,
  capability_contract_revision text,
  actor_principal_id text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, catalog_publication
as $$
declare
  new_revision bigint;
begin
  if capability_contract_revision is null
     or capability_contract_revision = ''
     or btrim(capability_contract_revision) <> capability_contract_revision
     or capability_contract_revision ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '23514',
      message = 'capability_contract_revision must be a non-empty control-free token';
  end if;

  if actor_principal_id is null
     or actor_principal_id = ''
     or btrim(actor_principal_id) <> actor_principal_id
     or actor_principal_id ~ '[[:cntrl:]]' then
    raise exception using
      errcode = '23514',
      message = 'actor_principal_id must be a non-empty control-free token';
  end if;

  update catalog_publication.publication_policies as policy
  set
    revision = policy.revision + 1,
    publication_enabled = revise_publication_policy.publication_enabled,
    low_risk_single_actor_publish = revise_publication_policy.low_risk_single_actor_publish,
    capability_contract_revision = revise_publication_policy.capability_contract_revision,
    updated_at = now(),
    updated_by_principal_id = revise_publication_policy.actor_principal_id
  where policy.singleton
  returning policy.revision into new_revision;

  if new_revision is null then
    raise exception using
      errcode = 'P0002',
      message = 'publication policy singleton is missing';
  end if;

  insert into catalog_publication.publication_policy_revisions (
    revision,
    publication_enabled,
    low_risk_single_actor_publish,
    capability_contract_revision,
    actor_principal_id
  ) values (
    new_revision,
    revise_publication_policy.publication_enabled,
    revise_publication_policy.low_risk_single_actor_publish,
    revise_publication_policy.capability_contract_revision,
    revise_publication_policy.actor_principal_id
  );

  return new_revision;
end;
$$;

create function catalog_publication.acquire_publication_guard_lock()
returns void
language plpgsql
security definer
set search_path = pg_catalog, catalog_publication
as $$
declare
  previous_lock_timeout text;
begin
  previous_lock_timeout := pg_catalog.current_setting('lock_timeout');
  perform pg_catalog.set_config('lock_timeout', '2s', true);
  begin
    perform 1
    from catalog_publication.publication_guard
    where singleton
    for update;
  exception
    when lock_not_available then
      perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
      raise exception using
        errcode = 'PCA05',
        message = 'catalog publication guard lock timed out',
        detail = 'PCAT-PUB-GUARD-BUSY';
  end;
  perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
end;
$$;

create table catalog_publication.release_artifacts (
  id text primary key
    check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]' and id like 'cart_%'),
  artifact_digest text not null unique
    check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  bytes_checksum text not null
    check (bytes_checksum ~ '^sha256:[0-9a-f]{64}$'),
  artifact_bytes bytea not null
    check (octet_length(artifact_bytes) > 0),
  source_kind text not null
    check (source_kind in (
      'typed-changeset',
      'vendor-yaml',
      'repository-bundle',
      'adopted-preexisting'
    )),
  target_release_id text not null
    check (target_release_id <> '' and btrim(target_release_id) = target_release_id and target_release_id !~ '[[:cntrl:]]'),
  target_release_digest text not null
    check (target_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  predecessor_release_id text
    check (
      predecessor_release_id is null
      or (
        predecessor_release_id <> ''
        and btrim(predecessor_release_id) = predecessor_release_id
        and predecessor_release_id !~ '[[:cntrl:]]'
      )
    ),
  predecessor_release_digest text
    check (
      predecessor_release_digest is null
      or predecessor_release_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  toolchain jsonb not null
    check (jsonb_typeof(toolchain) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, artifact_digest),
  check (
    (predecessor_release_id is null and predecessor_release_digest is null)
    or (predecessor_release_id is not null and predecessor_release_digest is not null)
  )
);

comment on column catalog_publication.release_artifacts.artifact_digest is
  'Compiler aggregate digest (sha256:<64 hex>). Not a substitute for Catalog identity and not the raw-bytes checksum.';
comment on column catalog_publication.release_artifacts.bytes_checksum is
  'SHA-256 of artifact_bytes only. Independent of artifact_digest.';

create table catalog_publication.candidates (
  id text primary key
    check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]' and id like 'ccand_%'),
  artifact_id text not null
    references catalog_publication.release_artifacts(id) on delete restrict,
  artifact_digest text not null
    check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_base_release_id text not null
    check (expected_base_release_id <> '' and btrim(expected_base_release_id) = expected_base_release_id and expected_base_release_id !~ '[[:cntrl:]]'),
  expected_base_release_digest text not null
    check (expected_base_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  proposal_id text
    check (
      proposal_id is null
      or (proposal_id <> '' and btrim(proposal_id) = proposal_id and proposal_id !~ '[[:cntrl:]]')
    ),
  proposal_revision_id text
    check (
      proposal_revision_id is null
      or (
        proposal_revision_id <> ''
        and btrim(proposal_revision_id) = proposal_revision_id
        and proposal_revision_id !~ '[[:cntrl:]]'
      )
    ),
  identity_allocation jsonb not null
    check (jsonb_typeof(identity_allocation) = 'object'),
  impact_report_digest text not null
    check (impact_report_digest ~ '^sha256:[0-9a-f]{64}$'),
  capability_contract jsonb not null
    check (jsonb_typeof(capability_contract) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, artifact_digest),
  unique (id, artifact_id, artifact_digest),
  unique (id, expected_base_release_id, expected_base_release_digest),
  unique (id, impact_report_digest),
  foreign key (artifact_id, artifact_digest)
    references catalog_publication.release_artifacts(id, artifact_digest)
    on delete restrict,
  foreign key (proposal_id, proposal_revision_id)
    references parameter_catalog.definition_proposal_revisions(proposal_id, id)
    on delete restrict,
  check (
    (proposal_id is null and proposal_revision_id is null)
    or (proposal_id is not null and proposal_revision_id is not null)
  )
);

create table catalog_publication.publication_authorizations (
  id text primary key
    check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]' and id like 'cauth_%'),
  event_kind text not null
    check (event_kind in ('approve', 'revoke')),
  candidate_id text not null
    references catalog_publication.candidates(id) on delete restrict,
  artifact_digest text not null
    check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_base_release_id text not null
    check (expected_base_release_id <> '' and btrim(expected_base_release_id) = expected_base_release_id and expected_base_release_id !~ '[[:cntrl:]]'),
  expected_base_release_digest text not null
    check (expected_base_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  proposal_revision_id text
    check (
      proposal_revision_id is null
      or (
        proposal_revision_id <> ''
        and btrim(proposal_revision_id) = proposal_revision_id
        and proposal_revision_id !~ '[[:cntrl:]]'
      )
    ),
  impact_report_digest text not null
    check (impact_report_digest ~ '^sha256:[0-9a-f]{64}$'),
  capability_contract_digest text not null
    check (capability_contract_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_revision bigint not null
    check (policy_revision > 0 and policy_revision <= 9007199254740991),
  actor_principal_id text not null
    check (actor_principal_id <> '' and btrim(actor_principal_id) = actor_principal_id and actor_principal_id !~ '[[:cntrl:]]'),
  approved_authorization_id text
    references catalog_publication.publication_authorizations(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, candidate_id),
  foreign key (candidate_id, artifact_digest)
    references catalog_publication.candidates(id, artifact_digest)
    on delete restrict,
  foreign key (candidate_id, expected_base_release_id, expected_base_release_digest)
    references catalog_publication.candidates(id, expected_base_release_id, expected_base_release_digest)
    on delete restrict,
  foreign key (candidate_id, impact_report_digest)
    references catalog_publication.candidates(id, impact_report_digest)
    on delete restrict,
  check (
    (event_kind = 'approve' and approved_authorization_id is null)
    or (event_kind = 'revoke' and approved_authorization_id is not null)
  )
);

create table catalog_publication.publication_jobs (
  id text primary key
    check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]' and id like 'cjob_%'),
  candidate_id text not null
    references catalog_publication.candidates(id) on delete restrict,
  authorization_id text not null,
  request_scope text not null
    check (request_scope <> '' and btrim(request_scope) = request_scope and request_scope !~ '[[:cntrl:]]'),
  idempotency_key text not null
    check (idempotency_key <> '' and btrim(idempotency_key) = idempotency_key and idempotency_key !~ '[[:cntrl:]]'),
  request_digest text not null
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text not null
    check (status in (
      'queued',
      'running',
      'active',
      'needs-rebase',
      'blocked',
      'failed-retryable',
      'failed-terminal',
      'cancelled'
    )),
  lease_owner text
    check (
      lease_owner is null
      or (lease_owner <> '' and btrim(lease_owner) = lease_owner and lease_owner !~ '[[:cntrl:]]')
    ),
  lease_until timestamptz,
  fencing_token bigint not null default 0
    check (fencing_token >= 0 and fencing_token <= 9007199254740991),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  last_error_class text
    check (
      last_error_class is null
      or (last_error_class <> '' and btrim(last_error_class) = last_error_class and last_error_class !~ '[[:cntrl:]]')
    ),
  last_error_reason text
    check (
      last_error_reason is null
      or (last_error_reason <> '' and btrim(last_error_reason) = last_error_reason and last_error_reason !~ '[[:cntrl:]]')
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_scope, idempotency_key),
  unique (id, candidate_id, authorization_id),
  foreign key (authorization_id, candidate_id)
    references catalog_publication.publication_authorizations(id, candidate_id)
    on delete restrict
);

comment on column catalog_publication.publication_jobs.request_scope is
  'Trusted instance/command scope assigned by the server. Never copied from an untrusted organization request body field.';

create table catalog_publication.publication_policies (
  singleton boolean primary key default true check (singleton),
  revision bigint not null
    check (revision > 0 and revision <= 9007199254740991),
  publication_enabled boolean not null default false,
  low_risk_single_actor_publish boolean not null default false,
  capability_contract_revision text not null
    check (
      capability_contract_revision <> ''
      and btrim(capability_contract_revision) = capability_contract_revision
      and capability_contract_revision !~ '[[:cntrl:]]'
    ),
  updated_at timestamptz not null default now(),
  updated_by_principal_id text not null
    check (
      updated_by_principal_id <> ''
      and btrim(updated_by_principal_id) = updated_by_principal_id
      and updated_by_principal_id !~ '[[:cntrl:]]'
    )
);

create table catalog_publication.publication_policy_revisions (
  revision bigint primary key
    check (revision > 0 and revision <= 9007199254740991),
  publication_enabled boolean not null,
  low_risk_single_actor_publish boolean not null,
  capability_contract_revision text not null
    check (
      capability_contract_revision <> ''
      and btrim(capability_contract_revision) = capability_contract_revision
      and capability_contract_revision !~ '[[:cntrl:]]'
    ),
  actor_principal_id text not null
    check (
      actor_principal_id <> ''
      and btrim(actor_principal_id) = actor_principal_id
      and actor_principal_id !~ '[[:cntrl:]]'
    ),
  created_at timestamptz not null default now()
);

create table catalog_publication.publication_guard (
  singleton boolean primary key default true check (singleton),
  epoch bigint not null default 0
    check (epoch >= 0 and epoch <= 9007199254740991),
  locked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table parameter_catalog.catalog_activation_receipts (
  id text primary key
    check (id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]' and id like 'crct_%'),
  kind text not null
    check (kind in ('online-publication', 'adopted-preexisting', 'bootstrap')),
  release_id text not null,
  release_digest text not null
    check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  predecessor_release_id text
    check (
      predecessor_release_id is null
      or (
        predecessor_release_id <> ''
        and btrim(predecessor_release_id) = predecessor_release_id
        and predecessor_release_id !~ '[[:cntrl:]]'
      )
    ),
  predecessor_release_digest text
    check (
      predecessor_release_digest is null
      or predecessor_release_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  verification_digest text not null
    check (verification_digest ~ '^sha256:[0-9a-f]{64}$'),
  publication_job_id text,
  authorization_id text,
  candidate_id text,
  actor_principal_id text not null
    check (actor_principal_id <> '' and btrim(actor_principal_id) = actor_principal_id and actor_principal_id !~ '[[:cntrl:]]'),
  adoption_evidence jsonb
    check (adoption_evidence is null or jsonb_typeof(adoption_evidence) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (release_id, release_digest)
    references parameter_catalog.catalog_releases(id, release_digest)
    on delete restrict,
  foreign key (predecessor_release_id, predecessor_release_digest)
    references parameter_catalog.catalog_releases(id, release_digest)
    on delete restrict,
  foreign key (candidate_id)
    references catalog_publication.candidates(id)
    on delete restrict,
  foreign key (authorization_id, candidate_id)
    references catalog_publication.publication_authorizations(id, candidate_id)
    on delete restrict,
  foreign key (publication_job_id, candidate_id, authorization_id)
    references catalog_publication.publication_jobs(id, candidate_id, authorization_id)
    on delete restrict,
  check (
    (predecessor_release_id is null and predecessor_release_digest is null)
    or (predecessor_release_id is not null and predecessor_release_digest is not null)
  ),
  check (
    (kind = 'online-publication'
      and publication_job_id is not null
      and authorization_id is not null
      and candidate_id is not null
      and predecessor_release_id is not null
      and predecessor_release_digest is not null
      and adoption_evidence is null)
    or (kind = 'adopted-preexisting'
      and publication_job_id is null
      and authorization_id is null
      and candidate_id is null
      and adoption_evidence is not null
      and jsonb_typeof(adoption_evidence) = 'object'
      and adoption_evidence ? 'source_bundle_digest'
      and adoption_evidence ? 'verification_digest'
      and adoption_evidence ? 'data_mode'
      and adoption_evidence ? 'collected_at'
      and adoption_evidence ? 'approved_by'
      and not (adoption_evidence ? 'bootstrap_command')
      and adoption_evidence->>'source_bundle_digest' ~ '^sha256:[0-9a-f]{64}$'
      and adoption_evidence->>'verification_digest' ~ '^sha256:[0-9a-f]{64}$'
      and adoption_evidence->>'data_mode' in ('fresh', 'populated', 'restored')
      and adoption_evidence->>'collected_at' <> ''
      and btrim(adoption_evidence->>'collected_at') = adoption_evidence->>'collected_at'
      and adoption_evidence->>'approved_by' <> ''
      and btrim(adoption_evidence->>'approved_by') = adoption_evidence->>'approved_by')
    or (kind = 'bootstrap'
      and publication_job_id is null
      and authorization_id is null
      and candidate_id is null
      and adoption_evidence is not null
      and jsonb_typeof(adoption_evidence) = 'object'
      and adoption_evidence ? 'bootstrap_command'
      and adoption_evidence ? 'approved_by'
      and adoption_evidence ? 'recorded_at'
      and not (adoption_evidence ? 'source_bundle_digest')
      and adoption_evidence->>'bootstrap_command' = 'explicit-bootstrap'
      and adoption_evidence->>'approved_by' <> ''
      and btrim(adoption_evidence->>'approved_by') = adoption_evidence->>'approved_by'
      and adoption_evidence->>'recorded_at' <> ''
      and btrim(adoption_evidence->>'recorded_at') = adoption_evidence->>'recorded_at')
  )
);

create unique index catalog_activation_receipts_job_uidx
  on parameter_catalog.catalog_activation_receipts (publication_job_id)
  where publication_job_id is not null;

create unique index catalog_activation_receipts_adopted_release_uidx
  on parameter_catalog.catalog_activation_receipts (kind, release_id)
  where kind = 'adopted-preexisting';

create unique index catalog_activation_receipts_bootstrap_release_uidx
  on parameter_catalog.catalog_activation_receipts (kind, release_id)
  where kind = 'bootstrap';

create function parameter_catalog.assert_activation_receipt_consistency()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog, catalog_publication
as $$
declare
  job_candidate_id text;
  job_authorization_id text;
  authorization_candidate_id text;
  authorization_kind text;
  expected_base_id text;
  expected_base_digest text;
  target_release_id text;
  target_release_digest text;
begin
  if new.kind = 'bootstrap' then
    if exists (select 1 from parameter_catalog.catalog_state) then
      raise exception using
        errcode = '23514',
        message = 'bootstrap activation receipt is forbidden when catalog_state exists',
        constraint = 'catalog_activation_receipt_bootstrap_empty_ck';
    end if;
    return new;
  end if;

  if new.kind <> 'online-publication' then
    return new;
  end if;

  select candidate_id, authorization_id
    into job_candidate_id, job_authorization_id
  from catalog_publication.publication_jobs
  where id = new.publication_job_id;

  if job_candidate_id is distinct from new.candidate_id
     or job_authorization_id is distinct from new.authorization_id then
    raise exception using
      errcode = '23514',
      message = 'online activation receipt job/candidate/authorization tuple mismatch',
      constraint = 'catalog_activation_receipt_online_tuple_ck';
  end if;

  select candidate_id, event_kind
    into authorization_candidate_id, authorization_kind
  from catalog_publication.publication_authorizations
  where id = new.authorization_id;

  if authorization_candidate_id is distinct from new.candidate_id
     or authorization_kind is distinct from 'approve' then
    raise exception using
      errcode = '23514',
      message = 'online activation receipt must reference an approve authorization for the same candidate',
      constraint = 'catalog_activation_receipt_online_authorization_ck';
  end if;

  select
    candidate.expected_base_release_id,
    candidate.expected_base_release_digest,
    artifact.target_release_id,
    artifact.target_release_digest
  into
    expected_base_id,
    expected_base_digest,
    target_release_id,
    target_release_digest
  from catalog_publication.candidates candidate
  join catalog_publication.release_artifacts artifact
    on artifact.id = candidate.artifact_id
  where candidate.id = new.candidate_id;

  if target_release_id is distinct from new.release_id
     or target_release_digest is distinct from new.release_digest then
    raise exception using
      errcode = '23514',
      message = 'online activation receipt release pin must equal the artifact target pin',
      constraint = 'catalog_activation_receipt_online_target_ck';
  end if;

  if expected_base_id is distinct from new.predecessor_release_id
     or expected_base_digest is distinct from new.predecessor_release_digest then
    raise exception using
      errcode = '23514',
      message = 'online activation receipt predecessor pin must equal the candidate expected base pin',
      constraint = 'catalog_activation_receipt_online_base_ck';
  end if;

  return new;
end;
$$;

create trigger release_artifacts_immutable
before update or delete on catalog_publication.release_artifacts
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger candidates_immutable
before update or delete on catalog_publication.candidates
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger publication_authorizations_immutable
before update or delete on catalog_publication.publication_authorizations
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger publication_authorizations_revoke_tuple
before insert on catalog_publication.publication_authorizations
for each row execute function catalog_publication.assert_authorization_revoke_tuple();

create trigger publication_jobs_identity_immutable
before update or delete on catalog_publication.publication_jobs
for each row execute function catalog_publication.reject_publication_job_identity_change();

create trigger publication_jobs_authorization_approve
before insert on catalog_publication.publication_jobs
for each row execute function catalog_publication.assert_job_authorization_approve();

create trigger publication_policy_revisions_immutable
before update or delete on catalog_publication.publication_policy_revisions
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger publication_policies_no_delete
before delete on catalog_publication.publication_policies
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger publication_policies_direct_update
before update on catalog_publication.publication_policies
for each row execute function catalog_publication.reject_direct_policy_update();

create trigger publication_guard_no_delete
before delete on catalog_publication.publication_guard
for each row execute function catalog_publication.reject_immutable_publication_change();

create trigger catalog_activation_receipts_immutable
before update or delete on parameter_catalog.catalog_activation_receipts
for each row execute function parameter_catalog.reject_immutable_catalog_change();

create trigger catalog_activation_receipts_consistency
before insert on parameter_catalog.catalog_activation_receipts
for each row execute function parameter_catalog.assert_activation_receipt_consistency();

insert into catalog_publication.publication_policies (
  singleton,
  revision,
  publication_enabled,
  low_risk_single_actor_publish,
  capability_contract_revision,
  updated_by_principal_id
) values (
  true,
  1,
  false,
  false,
  'catalog-capability/v1',
  'catalog-migration'
);

insert into catalog_publication.publication_policy_revisions (
  revision,
  publication_enabled,
  low_risk_single_actor_publish,
  capability_contract_revision,
  actor_principal_id
) values (
  1,
  false,
  false,
  'catalog-capability/v1',
  'catalog-migration'
);

insert into catalog_publication.publication_guard (singleton, epoch)
values (true, 0);

alter table catalog_publication.publication_authorizations
  add constraint publication_authorizations_policy_revision_fkey
  foreign key (policy_revision)
  references catalog_publication.publication_policy_revisions(revision)
  on delete restrict;

comment on column parameter_catalog.catalog_activation_receipts.adoption_evidence is
  'adopted-preexisting requires source_bundle_digest, verification_digest, data_mode, collected_at, approved_by. bootstrap requires bootstrap_command=explicit-bootstrap, approved_by, recorded_at and must not reuse adoption keys.';

do $$
declare
  obj record;
begin
  for obj in
    select class.relkind, format('%I.%I', namespace.nspname, class.relname) as object_id
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'catalog_publication'
      and class.relkind in ('r', 'p', 'S', 'v', 'm')
  loop
    if obj.relkind = 'S' then
      execute format('alter sequence %s owner to catalog_migration_owner', obj.object_id);
    else
      execute format('alter table %s owner to catalog_migration_owner', obj.object_id);
    end if;
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
    where namespace.nspname = 'catalog_publication'
  loop
    execute format('alter function %s owner to catalog_migration_owner', obj.object_id);
  end loop;
end;
$$;

alter table parameter_catalog.catalog_activation_receipts
  owner to catalog_migration_owner;
alter function parameter_catalog.assert_activation_receipt_consistency()
  owner to catalog_migration_owner;

revoke all on schema catalog_publication from public;
revoke all on all tables in schema catalog_publication from public;
revoke all on all sequences in schema catalog_publication from public;
revoke all on all functions in schema catalog_publication from public;

do $$
declare
  fn_signature text;
begin
  for fn_signature in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    )
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'catalog_publication'
  loop
    execute format('revoke all on function %s from public', fn_signature);
    execute format('revoke all on function %s from catalog_synchronizer_role', fn_signature);
    execute format('revoke all on function %s from parameter_governance_writer_role', fn_signature);
    execute format('revoke all on function %s from catalog_publication_coordinator_role', fn_signature);
    execute format('revoke all on function %s from catalog_baseline_reader_role', fn_signature);
  end loop;
end;
$$;

revoke all on function parameter_catalog.assert_activation_receipt_consistency()
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

revoke all on table parameter_catalog.catalog_activation_receipts
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role,
  catalog_verification_writer_role, catalog_verifier_role;

grant usage on schema catalog_publication to catalog_publication_coordinator_role;
grant usage on schema catalog_publication to catalog_synchronizer_role;
grant usage on schema catalog_publication to catalog_baseline_reader_role;
grant usage on schema parameter_catalog to catalog_publication_coordinator_role;
grant usage on schema parameter_catalog to catalog_baseline_reader_role;

grant select on table
  catalog_publication.release_artifacts,
  catalog_publication.candidates,
  catalog_publication.publication_authorizations,
  catalog_publication.publication_jobs,
  catalog_publication.publication_policies,
  catalog_publication.publication_policy_revisions,
  catalog_publication.publication_guard
to catalog_publication_coordinator_role, catalog_synchronizer_role, catalog_baseline_reader_role;

grant select on table parameter_catalog.catalog_activation_receipts
to catalog_publication_coordinator_role, catalog_synchronizer_role, catalog_baseline_reader_role;

grant select on table
  parameter_catalog.catalog_activation_receipts,
  parameter_catalog.catalog_command_idempotency,
  parameter_catalog.catalog_drivers,
  parameter_catalog.catalog_materializations,
  parameter_catalog.catalog_node_types,
  parameter_catalog.catalog_release_definition_heads,
  parameter_catalog.catalog_release_subject_aliases,
  parameter_catalog.catalog_release_subjects,
  parameter_catalog.catalog_releases,
  parameter_catalog.catalog_state,
  parameter_catalog.catalog_subject_aliases,
  parameter_catalog.catalog_subjects,
  parameter_catalog.definition_revisions,
  parameter_catalog.parameter_definitions
to catalog_baseline_reader_role;

grant insert on table
  catalog_publication.release_artifacts,
  catalog_publication.candidates,
  catalog_publication.publication_authorizations,
  catalog_publication.publication_jobs
to catalog_publication_coordinator_role;

grant insert on table parameter_catalog.catalog_activation_receipts
to catalog_synchronizer_role;

grant update (
  status,
  lease_owner,
  lease_until,
  fencing_token,
  attempt_count,
  last_error_class,
  last_error_reason,
  updated_at
) on table catalog_publication.publication_jobs
to catalog_publication_coordinator_role;

grant update on table catalog_publication.publication_guard
to catalog_publication_coordinator_role, catalog_synchronizer_role;

grant execute on function catalog_publication.acquire_publication_guard_lock()
to catalog_publication_coordinator_role, catalog_synchronizer_role;

grant execute on function catalog_publication.digest_jsonb(jsonb)
to catalog_publication_coordinator_role, catalog_synchronizer_role;

alter default privileges for role catalog_migration_owner in schema catalog_publication
  revoke all on tables from public;
alter default privileges for role catalog_migration_owner in schema catalog_publication
  revoke all on sequences from public;
alter default privileges for role catalog_migration_owner in schema catalog_publication
  revoke all on functions from public;
alter default privileges in schema catalog_publication
  revoke all on tables from public;
alter default privileges in schema catalog_publication
  revoke all on sequences from public;
alter default privileges in schema catalog_publication
  revoke all on functions from public;

select pg_catalog.pg_advisory_unlock(140014000140);
