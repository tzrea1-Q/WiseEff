-- Round 6: evidence-only review-task scope reconcile.
-- Do not trust existing project_id / config_revision_id / property_occurrence_id columns
-- (they may be polluted by an older 0055 backfill). Recompute solely from
-- source_evidence IDs via tenant-scoped joins; clear unproven FKs.

with evidence_scope as (
  select
    t.id,
    t.organization_id,
    t.status,
    t.parameter_spec_id as prior_parameter_spec_id,
    t.project_id as prior_project_id,
    t.config_revision_id as prior_config_revision_id,
    t.property_occurrence_id as prior_property_occurrence_id,
    t.source_evidence,
    nullif(t.source_evidence->>'projectId', '') as evidence_project_id,
    nullif(t.source_evidence->>'configRevisionId', '') as evidence_config_revision_id,
    nullif(t.source_evidence->>'propertyOccurrenceId', '') as evidence_property_occurrence_id,
    (
      select ps.id
      from parameter_specs ps
      where ps.id = t.parameter_spec_id
        and (ps.organization_id = t.organization_id or ps.organization_id is null)
      limit 1
    ) as proven_parameter_spec_id,
    (
      select p.id
      from projects p
      where p.id = nullif(t.source_evidence->>'projectId', '')
        and p.organization_id = t.organization_id
      limit 1
    ) as proven_project_id,
    (
      select cr.id
      from dts_config_revisions cr
      inner join projects p
        on p.id = cr.project_id
       and p.organization_id = t.organization_id
      where cr.id = nullif(t.source_evidence->>'configRevisionId', '')
        and cr.organization_id = t.organization_id
        and p.id = (
          select p2.id
          from projects p2
          where p2.id = nullif(t.source_evidence->>'projectId', '')
            and p2.organization_id = t.organization_id
          limit 1
        )
      limit 1
    ) as proven_config_revision_id,
    (
      select po.id
      from dts_property_occurrences po
      inner join dts_config_revisions cr on cr.id = po.config_revision_id
      inner join projects p
        on p.id = cr.project_id
       and p.organization_id = t.organization_id
      where po.id = nullif(t.source_evidence->>'propertyOccurrenceId', '')
        and cr.organization_id = t.organization_id
        and cr.id = (
          select cr2.id
          from dts_config_revisions cr2
          inner join projects p2
            on p2.id = cr2.project_id
           and p2.organization_id = t.organization_id
          where cr2.id = nullif(t.source_evidence->>'configRevisionId', '')
            and cr2.organization_id = t.organization_id
            and p2.id = nullif(t.source_evidence->>'projectId', '')
          limit 1
        )
        and p.id = nullif(t.source_evidence->>'projectId', '')
      limit 1
    ) as proven_property_occurrence_id
  from parameter_spec_review_tasks t
),
evaluated as (
  select
    e.*,
    (
      (
        e.evidence_project_id is not null
        and e.proven_project_id is null
      )
      or (
        e.evidence_config_revision_id is not null
        and e.proven_config_revision_id is null
      )
      or (
        e.evidence_property_occurrence_id is not null
        and e.proven_property_occurrence_id is null
      )
      or (
        e.prior_project_id is not null
        and e.evidence_project_id is null
      )
      or (
        e.prior_config_revision_id is not null
        and e.evidence_config_revision_id is null
      )
      or (
        e.prior_property_occurrence_id is not null
        and e.evidence_property_occurrence_id is null
      )
      or (
        e.prior_parameter_spec_id is not null
        and e.proven_parameter_spec_id is null
      )
      or coalesce(e.source_evidence->'scopeBackfill'->>'code', '') in (
        'polluted_or_unproven_scope',
        'missing_or_unproven_evidence_chain'
      )
    ) as has_unproven_scope,
    (
      (e.prior_project_id is not null and e.evidence_project_id is null)
      or (e.prior_config_revision_id is not null and e.evidence_config_revision_id is null)
      or (e.prior_property_occurrence_id is not null and e.evidence_property_occurrence_id is null)
      or coalesce(e.source_evidence->'scopeBackfill'->>'code', '') =
        'missing_or_unproven_evidence_chain'
    ) as has_missing_evidence_chain
  from evidence_scope e
),
computed as (
  select
    e.id,
    e.proven_project_id as project_id,
    e.proven_config_revision_id as config_revision_id,
    e.proven_property_occurrence_id as property_occurrence_id,
    case
      when e.has_unproven_scope then 'platform'
      when e.proven_config_revision_id is not null then 'revision'
      when e.proven_project_id is not null then 'project'
      when coalesce(e.source_evidence->>'inferred', '') = 'true' then 'platform'
      when e.evidence_project_id is not null
        or e.evidence_config_revision_id is not null
        or e.evidence_property_occurrence_id is not null
        then 'platform'
      else 'revision'
    end as blocker_scope,
    case
      when e.status in ('resolved', 'dismissed') and e.has_unproven_scope
        then 'open'
      else e.status
    end as status,
    coalesce(e.source_evidence, '{}'::jsonb) || jsonb_build_object(
      'scopeBackfill',
      coalesce(e.source_evidence->'scopeBackfill', '{}'::jsonb) || jsonb_build_object(
        'migration', '0058',
        'reconciledAt', coalesce(
          case
            when e.source_evidence->'scopeBackfill'->>'migration' = '0058'
              then e.source_evidence->'scopeBackfill'->'reconciledAt'
            else null
          end,
          to_jsonb(now()::text)
        ),
        'code',
          case
            when e.has_missing_evidence_chain
              then 'missing_or_unproven_evidence_chain'
            when (
              e.evidence_project_id is not null
              and e.proven_project_id is null
            )
            or (
              e.evidence_config_revision_id is not null
              and e.proven_config_revision_id is null
            )
            or (
              e.evidence_property_occurrence_id is not null
              and e.proven_property_occurrence_id is null
            )
            or (
              e.prior_parameter_spec_id is not null
              and e.proven_parameter_spec_id is null
            )
              then 'polluted_or_unproven_scope'
            else coalesce(e.source_evidence->'scopeBackfill'->>'code', 'evidence_scope_ok')
          end,
        'clearedPriorProjectId',
          case
            when e.prior_project_id is distinct from e.proven_project_id
              then e.prior_project_id
            else e.source_evidence->'scopeBackfill'->>'clearedPriorProjectId'
          end,
        'provenProjectId', e.proven_project_id,
        'provenConfigRevisionId', e.proven_config_revision_id,
        'provenPropertyOccurrenceId', e.proven_property_occurrence_id
      )
    ) as source_evidence
  from evaluated e
)
update parameter_spec_review_tasks t
set
  project_id = c.project_id,
  config_revision_id = c.config_revision_id,
  property_occurrence_id = c.property_occurrence_id,
  blocker_scope = c.blocker_scope,
  status = c.status,
  source_evidence = c.source_evidence,
  resolved_at = case when c.status = 'open' then null else t.resolved_at end,
  reviewer_user_id = case when c.status = 'open' then null else t.reviewer_user_id end,
  parameter_spec_id = case when c.status = 'open' then null else t.parameter_spec_id end
from computed c
where t.id = c.id
  and (
    t.project_id is distinct from c.project_id
    or t.config_revision_id is distinct from c.config_revision_id
    or t.property_occurrence_id is distinct from c.property_occurrence_id
    or t.blocker_scope is distinct from c.blocker_scope
    or t.status is distinct from c.status
    or t.source_evidence is distinct from c.source_evidence
    or (
      c.status = 'open'
      and (
        t.resolved_at is not null
        or t.reviewer_user_id is not null
        or t.parameter_spec_id is not null
      )
    )
  );
