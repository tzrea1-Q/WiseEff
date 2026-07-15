-- Org / project sensitive node rules for path|compatible matching → risk tier + required capability.
-- Append-only and idempotent.

create table if not exists dts_sensitive_node_rules (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text references projects(id) on delete cascade,
  match_type text not null check (match_type in ('path', 'compatible')),
  pattern text not null,
  risk_tier text not null check (risk_tier in ('high', 'critical')),
  required_capability text not null default 'parameter:edit-critical',
  enabled boolean not null default true,
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dts_sensitive_node_rules_org_project_idx
  on dts_sensitive_node_rules (organization_id, project_id)
  where enabled = true;

create index if not exists dts_sensitive_node_rules_org_match_idx
  on dts_sensitive_node_rules (organization_id, match_type, enabled);
