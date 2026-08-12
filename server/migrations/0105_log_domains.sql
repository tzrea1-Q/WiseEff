-- Agent log analysis P1: org-scoped log domains, upload binding, and analyzer provenance.
--
-- A log domain registers one business's log intake: a declarative format profile plus
-- (from P2) domain knowledge. Tenant isolation stays on organization_id; log_records.source
-- keeps meaning the intake channel. A NULL log_domain_id is the built-in uncategorized
-- log domain: generic analysis, upload never blocked.

create table if not exists log_domains (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  format_profile jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists log_domains_org_status_idx
  on log_domains (organization_id, status, name);

alter table log_records
  add column if not exists log_domain_id text references log_domains(id);

create index if not exists log_records_log_domain_idx
  on log_records (organization_id, log_domain_id);

-- Analyzer provenance: degraded analysis must never impersonate a full agent analysis.
-- analysis_source: 'agent' (LLM kernel) | 'rules-fallback' (degraded deterministic fallback);
-- NULL keeps the legacy rule-analyzer rows unmarked.
alter table log_analysis_reports
  add column if not exists analysis_source text,
  add column if not exists degraded_reason text,
  add column if not exists prompt_version text,
  add column if not exists model text;

-- Grant the log-domain governance permission to the admin roles seeded in `0021` / `0078`.
update roles
set permissions = array_append(permissions, 'logs:admin-domains')
where id in ('admin', 'platform-admin')
  and not ('logs:admin-domains' = any (permissions));
