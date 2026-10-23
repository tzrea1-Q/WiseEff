-- Keep the offline source reader on the same column-only authentication boundary
-- after revocation state and explicit project participation become part of AuthContext.
grant select (external_tokens_revoked_at) on public.users to wiseeff_mod_d02_source_reader;
grant select (organization_id, project_id, user_id, roles)
  on public.project_members to wiseeff_mod_d02_source_reader;
