-- Agent log analysis P3b: domain-level result webhooks + per-domain model override.
--
-- Webhook configuration lives as columns on log_domains (not a separate table): the
-- config is strictly 1:1 with a domain and is governed through the same
-- `logs:admin-domains` + withAuditedWrite path that already edits format_profile.
-- The signing secret is write-only at the API layer (never echoed; UI shows the
-- last four characters); it must stay retrievable server-side because HMAC-SHA256
-- needs the raw secret at delivery time.
--
-- log_webhook_deliveries records ONE ROW PER ATTEMPT (status: delivered | retrying |
-- failed) so /log-admin can show honest recent-delivery history including retries.
-- Delivery is best-effort and never blocks or fails the analysis itself.
-- The organization redundancy column + composite foreign keys follow the 0107
-- pattern so organization consistency is enforced by the schema, not call sites.
-- log_record_id / run_id are NULL for admin-triggered test deliveries (kind='test').

alter table log_domains
  add column if not exists webhook_url text,
  add column if not exists webhook_secret text,
  add column if not exists webhook_enabled boolean not null default false,
  add column if not exists model_override text;

-- Composite unique so the delivery table can composite-FK log records per 0107.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'log_records_id_org_unique') then
    alter table log_records
      add constraint log_records_id_org_unique unique (id, organization_id);
  end if;
end $$;

create table if not exists log_webhook_deliveries (
  id text primary key,
  organization_id text not null references organizations(id),
  log_domain_id text not null,
  log_record_id text,
  run_id text,
  kind text not null default 'result' check (kind in ('result', 'test')),
  attempt integer not null check (attempt >= 1),
  status text not null check (status in ('delivered', 'retrying', 'failed')),
  http_status integer,
  error text,
  created_at timestamptz not null default now(),
  -- Organization consistency: the delivery's organization must match both sides.
  foreign key (log_domain_id, organization_id)
    references log_domains (id, organization_id) on delete cascade,
  foreign key (log_record_id, organization_id)
    references log_records (id, organization_id) on delete cascade
);

create index if not exists log_webhook_deliveries_domain_recent_idx
  on log_webhook_deliveries (organization_id, log_domain_id, created_at desc);
