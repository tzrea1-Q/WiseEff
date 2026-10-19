-- Existing runs used the live domain links. Freeze that effective set before
-- backfilling the current publication; never fabricate historical retrievals.
alter table log_analysis_runs add column legacy_knowledge_entry_ids jsonb;
alter table log_analysis_runs add column knowledge_revisions jsonb not null default '[]'::jsonb
  check (jsonb_typeof(knowledge_revisions) = 'array');

update log_analysis_runs run set legacy_knowledge_entry_ids = coalesce((
  select jsonb_agg(link.knowledge_entry_id::text order by link.knowledge_entry_id)
  from log_records record join log_domain_knowledge_links link
    on link.log_domain_id = record.log_domain_id and link.organization_id = record.organization_id
  where record.id = run.log_record_id and record.organization_id = run.organization_id
), '[]'::jsonb);

-- Migration-only backfill under the migration transaction's table lock. Runtime
-- publications remain immutable and their hashes continue to describe their spec.
alter table log_skill_revisions disable trigger log_skill_revision_immutable;
update log_skill_revisions revision set spec = revision.spec || jsonb_build_object('knowledgeEntryIds', coalesce((
  select jsonb_agg(link.knowledge_entry_id::text order by link.knowledge_entry_id)
  from log_domain_knowledge_links link
  where link.log_domain_id = revision.skill_id and link.organization_id = revision.organization_id
), '[]'::jsonb)) where revision.status in ('published', 'draft');
update log_skill_revisions set content_hash = encode(sha256(convert_to(spec::text, 'UTF8')), 'hex')
  where status in ('published', 'draft');
-- Flush the deferred publication checks before altering this populated table.
set constraints log_skill_revision_requires_publication immediate;
alter table log_skill_revisions enable trigger log_skill_revision_immutable;
set constraints log_skill_revision_requires_publication deferred;
