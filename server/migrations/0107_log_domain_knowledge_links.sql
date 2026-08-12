-- Agent log analysis P2: log domains reference published knowledge-base entries.
--
-- The plan's original `log_domain_knowledge_docs` parallel table is superseded: the
-- knowledge base landed first (0103-0105), so domain knowledge lives there and a log
-- domain only LINKS to knowledge entries. `read_domain_knowledge` retrieval then runs
-- inside the linked entry set (falling back to organization-wide generic retrieval when
-- a domain has no links) and inherits the published-only invariant from the knowledge
-- module — links never widen retrieval to drafts or archived entries.
--
-- Every statement is re-application-safe: this file was briefly numbered 0106 (and
-- 0106_log_domains was 0105) before the duplicate-0105 renumbering, so databases that
-- applied it under the old name replay it cleanly under this one.

-- Composite uniques so the link table can enforce organization consistency with
-- composite foreign keys instead of trusting call-site discipline.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'log_domains_id_org_unique') then
    alter table log_domains
      add constraint log_domains_id_org_unique unique (id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_entries_id_org_unique') then
    alter table knowledge_entries
      add constraint knowledge_entries_id_org_unique unique (id, organization_id);
  end if;
end $$;

create table if not exists log_domain_knowledge_links (
  id text primary key,
  organization_id text not null references organizations(id),
  log_domain_id text not null,
  knowledge_entry_id uuid not null,
  created_by_user_id text not null references users(id),
  created_at timestamptz not null default now(),
  unique (log_domain_id, knowledge_entry_id),
  -- Organization consistency: the link's organization must match both sides.
  foreign key (log_domain_id, organization_id)
    references log_domains (id, organization_id) on delete cascade,
  foreign key (knowledge_entry_id, organization_id)
    references knowledge_entries (id, organization_id) on delete cascade
);

create index if not exists log_domain_knowledge_links_domain_idx
  on log_domain_knowledge_links (organization_id, log_domain_id, created_at desc);

create index if not exists log_domain_knowledge_links_entry_idx
  on log_domain_knowledge_links (organization_id, knowledge_entry_id);
