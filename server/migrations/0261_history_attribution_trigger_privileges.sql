-- History capture must not require an append-only audit writer to read account
-- or organization tables. Elevate only the installed trigger entry points.
-- Reuse the existing NOLOGIN owner; runtime writer table grants stay unchanged.
grant select (id, name, organization_id) on public.users to catalog_migration_owner;
grant select (user_id, organization_id, role_id, project_id) on public.user_role_bindings to catalog_migration_owner;
grant select (id, organization_id) on public.project_parameter_files to catalog_migration_owner;
grant select (id, name, organization_id) on public.log_integration_credentials to catalog_migration_owner;

alter function public.capture_parameter_history_attribution() owner to catalog_migration_owner;
alter function public.capture_parameter_history_attribution() security definer;
alter function public.capture_parameter_history_attribution() set search_path = pg_catalog, public, pg_temp;
revoke all on function public.capture_parameter_history_attribution() from public;

alter function public.capture_knowledge_log_agent_attribution() owner to catalog_migration_owner;
alter function public.capture_knowledge_log_agent_attribution() security definer;
alter function public.capture_knowledge_log_agent_attribution() set search_path = pg_catalog, public, pg_temp;
revoke all on function public.capture_knowledge_log_agent_attribution() from public;

-- This helper remains an invoker: a caller cannot use it to read identities
-- beyond its own table permissions. Explicit pg_temp-last also protects the
-- trigger's nested lookup from caller-created temporary identity tables.
alter function public.knowledge_log_agent_identity_snapshot(text, text, text, text) security invoker;
alter function public.knowledge_log_agent_identity_snapshot(text, text, text, text)
  set search_path = pg_catalog, public, pg_temp;
