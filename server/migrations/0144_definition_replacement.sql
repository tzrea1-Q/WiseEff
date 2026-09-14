-- Wayfinder #668 / Issue #847 (S2-REPL): Definition identity correction migration.
--
-- This migration implements the persisted model of the frozen design
-- `docs/exec-plans/active/2026-09-14-definition-identity-correction-threat-matrix.md`
-- section 3: the approved replacement record, the per-project scope manifest,
-- value provenance on the immutable ProjectValue relation, the current-selection
-- projection and its exact-id resolver, the deferred guard that rejects a write
-- naming a replaced current Binding, and the one-current-successor index.
--
-- It never authors Catalog truth.  New definition/revision rows and release
-- heads only appear through the existing complete-successor / Candidate /
-- Authorization / publication path recorded in migration 0140.  Nothing here
-- relaxes an existing constraint or trigger.

-- ---------------------------------------------------------------------------
-- 3.3 first: value provenance needs the candidate key on the target relation.
-- ---------------------------------------------------------------------------

alter table parameter_catalog.project_parameter_values
  add constraint project_parameter_values_id_definition_unique
  unique (id, definition_id);

alter table parameter_catalog.project_parameter_values
  add column replaced_from_value_id text;

alter table parameter_catalog.project_parameter_values
  add constraint project_parameter_value_replacement_source_fk
  foreign key (replaced_from_value_id, definition_id)
  references parameter_catalog.project_parameter_values(id, definition_id)
  on delete restrict;

alter table parameter_catalog.project_parameter_values
  add constraint project_parameter_value_replacement_source_ck
  check (replaced_from_value_id is null or replaced_from_value_id <> id);

comment on column parameter_catalog.project_parameter_values.replaced_from_value_id is
  'Old-definition ProjectValue this carried-forward row replaces. Null for an ordinary append.';

-- 3.2 needs a tenant-complete candidate key on the Binding relation.
alter table parameter_catalog.project_parameter_bindings
  add constraint project_parameter_bindings_id_org_project_unique
  unique (id, organization_id, project_id);

-- ---------------------------------------------------------------------------
-- 3.1a Preview records: the frozen preview a create binds to.
--
-- The frozen HTTP contract (dtoSchemas/parameterCatalog.ts) returns a
-- `previewId` and an `expiresAt` from preview, and `create` binds to that exact
-- preview identity.  The preview therefore has to be persisted.
-- ---------------------------------------------------------------------------

create table parameter_catalog.definition_replacement_previews (
  id text primary key
    check (id like 'drpv_%' and id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  old_definition_id text not null
    check (old_definition_id <> '' and btrim(old_definition_id) = old_definition_id and old_definition_id !~ '[[:cntrl:]]'),
  old_subject_id text not null
    check (old_subject_id <> '' and btrim(old_subject_id) = old_subject_id and old_subject_id !~ '[[:cntrl:]]'),
  old_property_key text not null
    check (old_property_key <> '' and btrim(old_property_key) = old_property_key and old_property_key !~ '[[:cntrl:]]'),
  old_revision_id text not null
    check (old_revision_id <> '' and btrim(old_revision_id) = old_revision_id and old_revision_id !~ '[[:cntrl:]]'),
  new_definition_id text not null
    check (new_definition_id <> '' and btrim(new_definition_id) = new_definition_id and new_definition_id !~ '[[:cntrl:]]'),
  new_subject_id text not null
    check (new_subject_id <> '' and btrim(new_subject_id) = new_subject_id and new_subject_id !~ '[[:cntrl:]]'),
  new_property_key text not null
    check (new_property_key <> '' and btrim(new_property_key) = new_property_key and new_property_key !~ '[[:cntrl:]]'),
  new_revision_id text not null
    check (new_revision_id <> '' and btrim(new_revision_id) = new_revision_id and new_revision_id !~ '[[:cntrl:]]'),
  preview_fingerprint text not null
    check (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  preview_catalog_release_id text not null
    check (preview_catalog_release_id <> '' and btrim(preview_catalog_release_id) = preview_catalog_release_id and preview_catalog_release_id !~ '[[:cntrl:]]'),
  preview_catalog_release_digest text not null
    check (preview_catalog_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id text not null
    check (candidate_id <> '' and btrim(candidate_id) = candidate_id and candidate_id !~ '[[:cntrl:]]'),
  artifact_digest text not null
    check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'),
  blockers jsonb not null check (jsonb_typeof(blockers) = 'array'),
  impact jsonb not null check (jsonb_typeof(impact) = 'object'),
  approval_principal_id text not null
    check (approval_principal_id <> '' and btrim(approval_principal_id) = approval_principal_id and approval_principal_id !~ '[[:cntrl:]]'),
  reason text not null
    check (reason <> '' and btrim(reason) = reason and reason !~ '[[:cntrl:]]'),
  consumed_by_replacement_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (old_definition_id, old_subject_id)
    references parameter_catalog.parameter_definitions(id, subject_id)
    on delete restrict
    deferrable initially deferred,
  foreign key (old_definition_id, old_revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict
    deferrable initially deferred,
  foreign key (candidate_id)
    references catalog_publication.candidates(id)
    on delete restrict
    deferrable initially deferred
);

create function parameter_catalog.protect_definition_replacement_preview_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Definition replacement previews cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.old_definition_id is distinct from old.old_definition_id
     or new.old_subject_id is distinct from old.old_subject_id
     or new.old_property_key is distinct from old.old_property_key
     or new.old_revision_id is distinct from old.old_revision_id
     or new.new_definition_id is distinct from old.new_definition_id
     or new.new_subject_id is distinct from old.new_subject_id
     or new.new_property_key is distinct from old.new_property_key
     or new.new_revision_id is distinct from old.new_revision_id
     or new.preview_fingerprint is distinct from old.preview_fingerprint
     or new.preview_catalog_release_id is distinct from old.preview_catalog_release_id
     or new.preview_catalog_release_digest is distinct from old.preview_catalog_release_digest
     or new.candidate_id is distinct from old.candidate_id
     or new.artifact_digest is distinct from old.artifact_digest
     or new.manifest is distinct from old.manifest
     or new.blockers is distinct from old.blockers
     or new.impact is distinct from old.impact
     or new.approval_principal_id is distinct from old.approval_principal_id
     or new.reason is distinct from old.reason
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Definition replacement preview identity is immutable';
  end if;
  return new;
end;
$$;

create trigger definition_replacement_preview_identity_immutable
before update or delete on parameter_catalog.definition_replacement_previews
for each row execute function parameter_catalog.protect_definition_replacement_preview_identity();

-- ---------------------------------------------------------------------------
-- 3.1 Definition replacements: the approved replacement record.
-- ---------------------------------------------------------------------------

create table parameter_catalog.definition_replacements (
  id text primary key
    check (id like 'drep_%' and id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  organization_id text not null references public.organizations(id) on delete restrict,
  status text not null
    check (status in ('pending', 'executing', 'completed', 'blocked', 'failed')),
  replacement_version bigint not null check (replacement_version > 0),
  old_definition_id text not null
    check (old_definition_id <> '' and btrim(old_definition_id) = old_definition_id and old_definition_id !~ '[[:cntrl:]]'),
  old_subject_id text not null
    check (old_subject_id <> '' and btrim(old_subject_id) = old_subject_id and old_subject_id !~ '[[:cntrl:]]'),
  old_property_key text not null
    check (old_property_key <> '' and btrim(old_property_key) = old_property_key and old_property_key !~ '[[:cntrl:]]'),
  old_revision_id text not null
    check (old_revision_id <> '' and btrim(old_revision_id) = old_revision_id and old_revision_id !~ '[[:cntrl:]]'),
  new_definition_id text not null
    check (new_definition_id <> '' and btrim(new_definition_id) = new_definition_id and new_definition_id !~ '[[:cntrl:]]'),
  new_subject_id text not null
    check (new_subject_id <> '' and btrim(new_subject_id) = new_subject_id and new_subject_id !~ '[[:cntrl:]]'),
  new_property_key text not null
    check (new_property_key <> '' and btrim(new_property_key) = new_property_key and new_property_key !~ '[[:cntrl:]]'),
  new_revision_id text not null
    check (new_revision_id <> '' and btrim(new_revision_id) = new_revision_id and new_revision_id !~ '[[:cntrl:]]'),
  preview_fingerprint text not null
    check (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  preview_catalog_release_id text not null
    check (preview_catalog_release_id <> '' and btrim(preview_catalog_release_id) = preview_catalog_release_id and preview_catalog_release_id !~ '[[:cntrl:]]'),
  preview_catalog_release_digest text not null
    check (preview_catalog_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_preview_id text not null,
  frozen_manifest jsonb not null check (jsonb_typeof(frozen_manifest) = 'array'),
  candidate_id text,
  publication_job_id text,
  authorization_id text,
  successor_release_id text
    check (
      successor_release_id is null
      or (successor_release_id <> '' and btrim(successor_release_id) = successor_release_id and successor_release_id !~ '[[:cntrl:]]')
    ),
  successor_release_digest text
    check (successor_release_digest is null or successor_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_principal_id text not null
    check (approval_principal_id <> '' and btrim(approval_principal_id) = approval_principal_id and approval_principal_id !~ '[[:cntrl:]]'),
  approver_principal_id text
    check (
      approver_principal_id is null
      or (approver_principal_id <> '' and btrim(approver_principal_id) = approver_principal_id and approver_principal_id !~ '[[:cntrl:]]')
    ),
  reason text not null
    check (reason <> '' and btrim(reason) = reason and reason !~ '[[:cntrl:]]'),
  success_audit_ref text
    check (
      success_audit_ref is null
      or (success_audit_ref <> '' and btrim(success_audit_ref) = success_audit_ref and success_audit_ref !~ '[[:cntrl:]]')
    ),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, old_definition_id),
  unique (id, new_definition_id),
  unique (id, organization_id),
  check (old_definition_id <> new_definition_id),
  check (
    (candidate_id is null and publication_job_id is null and authorization_id is null)
    or (candidate_id is not null and publication_job_id is not null and authorization_id is not null)
  ),
  foreign key (source_preview_id)
    references parameter_catalog.definition_replacement_previews(id)
    on delete restrict,
  foreign key (old_definition_id, old_subject_id)
    references parameter_catalog.parameter_definitions(id, subject_id)
    on delete restrict
    deferrable initially deferred,
  foreign key (old_definition_id, old_revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict
    deferrable initially deferred,
  foreign key (new_definition_id, new_subject_id)
    references parameter_catalog.parameter_definitions(id, subject_id)
    on delete restrict
    deferrable initially deferred,
  foreign key (new_definition_id, new_revision_id)
    references parameter_catalog.definition_revisions(definition_id, id)
    on delete restrict
    deferrable initially deferred,
  foreign key (publication_job_id, candidate_id, authorization_id)
    references catalog_publication.publication_jobs(id, candidate_id, authorization_id)
    on delete restrict
    deferrable initially deferred
);

-- One current successor per old definition.  A `failed` row is excluded so a
-- fresh preview may retry; `blocked` deliberately holds the slot so continuation,
-- not a second replacement, is the correction path.
create unique index definition_replacements_current_successor_unique
on parameter_catalog.definition_replacements (old_definition_id)
where status in ('pending', 'executing', 'completed', 'blocked');

create function parameter_catalog.protect_definition_replacement_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Definition replacements cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.old_definition_id is distinct from old.old_definition_id
     or new.old_subject_id is distinct from old.old_subject_id
     or new.old_property_key is distinct from old.old_property_key
     or new.old_revision_id is distinct from old.old_revision_id
     or new.new_definition_id is distinct from old.new_definition_id
     or new.new_subject_id is distinct from old.new_subject_id
     or new.new_property_key is distinct from old.new_property_key
     or new.new_revision_id is distinct from old.new_revision_id
     or new.preview_fingerprint is distinct from old.preview_fingerprint
     or new.preview_catalog_release_id is distinct from old.preview_catalog_release_id
     or new.preview_catalog_release_digest is distinct from old.preview_catalog_release_digest
     or new.source_preview_id is distinct from old.source_preview_id
     or new.frozen_manifest is distinct from old.frozen_manifest
     or new.candidate_id is distinct from old.candidate_id
     or new.publication_job_id is distinct from old.publication_job_id
     or new.authorization_id is distinct from old.authorization_id
     or new.approval_principal_id is distinct from old.approval_principal_id
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Definition replacement identity is immutable';
  end if;
  return new;
end;
$$;

create trigger definition_replacement_identity_immutable
before update or delete on parameter_catalog.definition_replacements
for each row execute function parameter_catalog.protect_definition_replacement_identity();

-- No replacement chains: the target definition must not itself be the source of
-- another current (non-failed) replacement.  The current-selection rule follows
-- the completed edge exactly once.
create function parameter_catalog.assert_definition_replacement_no_chain()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if exists (
    select 1
    from parameter_catalog.definition_replacements source
    where source.old_definition_id = new.new_definition_id
      and source.status <> 'failed'
      and source.id <> new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'The replacement target is already the source of a current definition replacement',
      constraint = 'definition_replacement_no_chain_ck';
  end if;
  return null;
end;
$$;

create constraint trigger definition_replacement_no_chain_ck
after insert or update of new_definition_id, status
on parameter_catalog.definition_replacements
deferrable initially deferred
for each row execute function parameter_catalog.assert_definition_replacement_no_chain();

-- ---------------------------------------------------------------------------
-- 3.2 Per-project scope manifest with old-to-new pairing.
-- ---------------------------------------------------------------------------

create table parameter_catalog.definition_replacement_projects (
  id text primary key
    check (id like 'drepp_%' and id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'),
  replacement_id text not null,
  organization_id text not null,
  project_id text not null
    check (project_id <> '' and btrim(project_id) = project_id and project_id !~ '[[:cntrl:]]'),
  status text not null
    check (status in ('completed', 'blocked', 'failed', 'pending')),
  blocker_reason text
    check (blocker_reason is null or (blocker_reason <> '' and btrim(blocker_reason) = blocker_reason and blocker_reason !~ '[[:cntrl:]]')),
  blocked_evidence jsonb
    check (blocked_evidence is null or jsonb_typeof(blocked_evidence) = 'object'),
  old_binding_id text not null
    check (old_binding_id <> '' and btrim(old_binding_id) = old_binding_id and old_binding_id !~ '[[:cntrl:]]'),
  old_value_id text not null
    check (old_value_id <> '' and btrim(old_value_id) = old_value_id and old_value_id !~ '[[:cntrl:]]'),
  new_binding_id text,
  new_value_id text,
  old_definition_id text not null,
  new_definition_id text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_class text
    check (last_error_class is null or (last_error_class <> '' and btrim(last_error_class) = last_error_class and last_error_class !~ '[[:cntrl:]]')),
  last_error_reason text
    check (last_error_reason is null or (last_error_reason <> '' and btrim(last_error_reason) = last_error_reason and last_error_reason !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (replacement_id, project_id),
  unique (id, replacement_id),
  check (
    (status = 'completed' and new_binding_id is not null and new_value_id is not null and blocker_reason is null)
    or (status <> 'completed' and new_binding_id is null and new_value_id is null)
  ),
  check ((new_binding_id is null) = (new_value_id is null)),
  foreign key (replacement_id, new_definition_id)
    references parameter_catalog.definition_replacements(id, new_definition_id)
    on delete restrict,
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete restrict,
  foreign key (old_binding_id, organization_id, project_id)
    references parameter_catalog.project_parameter_bindings(id, organization_id, project_id)
    on delete restrict,
  foreign key (old_binding_id, old_definition_id)
    references parameter_catalog.project_parameter_bindings(id, definition_id)
    on delete restrict,
  foreign key (old_binding_id, old_value_id)
    references parameter_catalog.project_parameter_values(binding_id, id)
    on delete restrict,
  foreign key (new_binding_id, new_definition_id)
    references parameter_catalog.project_parameter_bindings(id, definition_id)
    on delete restrict
    deferrable initially deferred,
  foreign key (new_binding_id, new_value_id)
    references parameter_catalog.project_parameter_values(binding_id, id)
    on delete restrict
    deferrable initially deferred,
  constraint definition_replacement_project_new_pair_ck
    check ((new_binding_id is null and new_value_id is null) or (new_binding_id is not null and new_value_id is not null))
);

create index definition_replacement_projects_org_idx
on parameter_catalog.definition_replacement_projects (organization_id, project_id);

create function parameter_catalog.protect_definition_replacement_project_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Definition replacement projects cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.replacement_id is distinct from old.replacement_id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.old_binding_id is distinct from old.old_binding_id
     or new.old_value_id is distinct from old.old_value_id
     or new.old_definition_id is distinct from old.old_definition_id
     or new.new_definition_id is distinct from old.new_definition_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Definition replacement project identity is immutable';
  end if;
  return new;
end;
$$;

create trigger definition_replacement_project_identity_immutable
before update or delete on parameter_catalog.definition_replacement_projects
for each row execute function parameter_catalog.protect_definition_replacement_project_identity();

-- A completed project may only be written inside the transaction that inserts
-- both its Binding and its first value, so a retry cannot duplicate either.
create function parameter_catalog.assert_definition_replacement_project_complete_is_final()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception using
      errcode = '55000',
      message = 'A completed definition replacement project cannot be reopened';
  end if;
  return new;
end;
$$;

create trigger definition_replacement_project_completed_is_final
before update on parameter_catalog.definition_replacement_projects
for each row execute function parameter_catalog.assert_definition_replacement_project_complete_is_final();

-- ---------------------------------------------------------------------------
-- 4. Current-selection rule: the projection and the exact-id resolver.
-- ---------------------------------------------------------------------------

create view parameter_catalog.current_project_parameter_bindings as
select binding.*
from parameter_catalog.project_parameter_bindings binding
where not exists (
  select 1
  from parameter_catalog.definition_replacement_projects replacement
  where replacement.status = 'completed'
    and replacement.old_binding_id = binding.id
);

comment on view parameter_catalog.current_project_parameter_bindings is
  'Effective current Bindings: every Binding except one that a completed definition replacement superseded. Historical, pinned and revision-addressed reads address the exact Binding id and never consult this view.';

create function parameter_catalog.is_replaced_current_binding(p_binding_id text)
returns boolean
language sql
stable
set search_path = pg_catalog, parameter_catalog
as $$
select exists (
  select 1
  from parameter_catalog.definition_replacement_projects replacement
  where replacement.status = 'completed'
    and replacement.old_binding_id = p_binding_id
);
$$;

create function parameter_catalog.resolve_current_binding(
  p_project_id text,
  p_logical_node_id text,
  p_definition_id text
)
returns text
language sql
stable
set search_path = pg_catalog, parameter_catalog
as $$
select coalesce(
  (
    select replacement.new_binding_id
    from parameter_catalog.project_parameter_bindings binding
    join parameter_catalog.definition_replacement_projects replacement
      on replacement.status = 'completed'
     and replacement.old_binding_id = binding.id
    where binding.project_id = p_project_id
      and binding.logical_node_id = p_logical_node_id
      and binding.definition_id = p_definition_id
    limit 1
  ),
  (
    select binding.id
    from parameter_catalog.project_parameter_bindings binding
    where binding.project_id = p_project_id
      and binding.logical_node_id = p_logical_node_id
      and binding.definition_id = p_definition_id
    limit 1
  )
);
$$;

create function parameter_catalog.assert_value_target_binding_is_current()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if exists (
    select 1
    from parameter_catalog.definition_replacement_projects replacement
    where replacement.status = 'completed'
      and replacement.old_binding_id = new.binding_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Project parameter values cannot target a replaced Binding',
      constraint = 'project_value_current_binding_ck';
  end if;
  return null;
end;
$$;

create constraint trigger project_value_current_binding_ck
after insert on parameter_catalog.project_parameter_values
deferrable initially deferred
for each row execute function parameter_catalog.assert_value_target_binding_is_current();
