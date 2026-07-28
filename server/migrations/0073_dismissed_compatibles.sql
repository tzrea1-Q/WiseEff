-- Dismissed compatibles: Admin can take an observed compatible out of the
-- unclassified queue without creating a driver group (ADR-0004 queue closure).

create table if not exists parameter_module_dismissed_compatibles (
  id text primary key,
  organization_id text not null references organizations(id),
  compatible text not null,
  reason text not null default '',
  dismissed_by_user_id text references users(id),
  dismissed_at timestamptz not null default now()
);

create unique index if not exists parameter_module_dismissed_compatibles_org_compatible_idx
  on parameter_module_dismissed_compatibles (organization_id, lower(compatible));

create index if not exists parameter_module_dismissed_compatibles_org_idx
  on parameter_module_dismissed_compatibles (organization_id);
