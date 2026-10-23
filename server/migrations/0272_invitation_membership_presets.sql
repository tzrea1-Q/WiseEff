-- Keep the offered targets even after deletion so acceptance fails explicitly rather
-- than silently dropping part of the offer. Names are offer-time display snapshots.
alter table public.organization_invitations
  add column team_presets jsonb not null default '[]' check(jsonb_typeof(team_presets)='array'),
  add column project_presets jsonb not null default '[]' check(jsonb_typeof(project_presets)='array');
