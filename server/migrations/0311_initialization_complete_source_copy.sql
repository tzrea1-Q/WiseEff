-- A draft retains only exact server-derived source proofs; source bytes stay in
-- their immutable versions and approval creates fresh private target identities.
alter table public.project_parameter_initialization_drafts
  add column source_config_snapshots jsonb null
  check (source_config_snapshots is null or jsonb_typeof(source_config_snapshots)='array');
