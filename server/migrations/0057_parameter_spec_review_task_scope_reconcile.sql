-- Round 5: idempotent reconcile for review-task scope columns after tenant-validated backfill.

with scoped as (
  select
    t.id,
    coalesce(
      nullif(t.project_id, ''),
      (
        select p.id
        from projects p
        where p.id = nullif(t.source_evidence->>'projectId', '')
          and p.organization_id = t.organization_id
        limit 1
      )
    ) as validated_project_id,
    coalesce(
      nullif(t.config_revision_id, ''),
      (
        select cr.id
        from dts_config_revisions cr
        inner join projects p
          on p.id = cr.project_id
         and p.organization_id = t.organization_id
        where cr.id = nullif(t.source_evidence->>'configRevisionId', '')
          and cr.organization_id = t.organization_id
          and p.id = coalesce(
            nullif(t.project_id, ''),
            nullif(t.source_evidence->>'projectId', '')
          )
        limit 1
      )
    ) as validated_config_revision_id,
    coalesce(
      nullif(t.property_occurrence_id, ''),
      (
        select po.id
        from dts_property_occurrences po
        inner join dts_config_revisions cr on cr.id = po.config_revision_id
        inner join projects p
          on p.id = cr.project_id
         and p.organization_id = t.organization_id
        where po.id = nullif(t.source_evidence->>'propertyOccurrenceId', '')
          and cr.organization_id = t.organization_id
          and cr.id = coalesce(
            nullif(t.config_revision_id, ''),
            nullif(t.source_evidence->>'configRevisionId', '')
          )
          and p.id = coalesce(
            nullif(t.project_id, ''),
            nullif(t.source_evidence->>'projectId', '')
          )
        limit 1
      )
    ) as validated_property_occurrence_id,
    nullif(t.source_evidence->>'projectId', '') as requested_project_id,
    nullif(t.source_evidence->>'configRevisionId', '') as requested_config_revision_id,
    nullif(t.source_evidence->>'propertyOccurrenceId', '') as requested_property_occurrence_id,
    t.source_evidence,
    t.blocker_scope
  from parameter_spec_review_tasks t
),
computed as (
  select
    s.id,
    s.validated_project_id as project_id,
    s.validated_config_revision_id as config_revision_id,
    s.validated_property_occurrence_id as property_occurrence_id,
    case
      when s.validated_config_revision_id is not null then 'revision'
      when s.validated_project_id is not null then 'project'
      when coalesce(s.source_evidence->>'inferred', '') = 'true' then 'platform'
      when s.requested_project_id is not null
        or s.requested_config_revision_id is not null
        or s.requested_property_occurrence_id is not null
        then 'platform'
      else coalesce(nullif(s.blocker_scope, ''), 'revision')
    end as blocker_scope,
    case
      when (
        s.requested_project_id is not null
        and s.validated_project_id is null
      )
      or (
        s.requested_config_revision_id is not null
        and s.validated_config_revision_id is null
      )
      or (
        s.requested_property_occurrence_id is not null
        and s.validated_property_occurrence_id is null
      )
        then coalesce(s.source_evidence, '{}'::jsonb) || jsonb_build_object(
          'scopeBackfill',
          coalesce(s.source_evidence->'scopeBackfill', '{}'::jsonb) || jsonb_build_object(
            'code', 'invalid_review_evidence',
            'requestedProjectId', s.requested_project_id,
            'requestedConfigRevisionId', s.requested_config_revision_id,
            'requestedPropertyOccurrenceId', s.requested_property_occurrence_id,
            'migration', '0057',
            'reconciledAt', to_jsonb(now()::text)
          )
        )
      else s.source_evidence
    end as source_evidence
  from scoped s
)
update parameter_spec_review_tasks t
set
  project_id = c.project_id,
  config_revision_id = c.config_revision_id,
  property_occurrence_id = c.property_occurrence_id,
  blocker_scope = c.blocker_scope,
  source_evidence = c.source_evidence
from computed c
where t.id = c.id
  and (
    t.project_id is distinct from c.project_id
    or t.config_revision_id is distinct from c.config_revision_id
    or t.property_occurrence_id is distinct from c.property_occurrence_id
    or t.blocker_scope is distinct from c.blocker_scope
    or t.source_evidence is distinct from c.source_evidence
  );
