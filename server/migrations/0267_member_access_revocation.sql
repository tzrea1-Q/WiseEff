-- A re-enabled member must authenticate again instead of reviving an old external token.
alter table public.users add column external_tokens_revoked_at timestamptz;
