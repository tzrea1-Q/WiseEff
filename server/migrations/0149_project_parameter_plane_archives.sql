-- Issue #849 scope item 4: offline archive of a project's legacy parameter plane,
-- captured before any seed rebuild replaces it.
--
-- Capture only. This migration creates the record of what was preserved; it does not
-- delete, truncate or replace anything. Disposal of the archived plane is a separate
-- reviewed decision and has no representation here.
create table if not exists project_parameter_plane_archives (
  id text primary key check (id <> '' and btrim(id) = id),
  organization_id text not null references public.organizations(id) on delete restrict,
  project_id text not null references public.projects(id) on delete restrict,
  scope text not null check (scope in ('legacy-parameter-plane')),
  object_ref text not null check (object_ref <> ''),
  -- Digest of the archived document bytes.
  content_digest text not null check (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  -- Digest over the scope, the counts and the content digest. Re-archiving an
  -- unchanged plane produces the same value, which is what makes the write idempotent.
  archive_digest text not null check (archive_digest ~ '^sha256:[0-9a-f]{64}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  -- True when any relation hit the per-relation row cap, so a partial archive can
  -- never be mistaken for a complete one.
  truncated boolean not null default false,
  created_by text not null check (created_by <> ''),
  created_at timestamptz not null default now(),
  unique (organization_id, project_id, scope, archive_digest)
);

create index if not exists project_parameter_plane_archives_project_idx
  on project_parameter_plane_archives (organization_id, project_id, created_at desc);
