-- Fixed four-domain progress survives later-domain failure and process restart.
-- No tenant payload or object keys belong in this independent receipt.
alter table public.organization_erasures add column domain_progress jsonb not null default '{}';
