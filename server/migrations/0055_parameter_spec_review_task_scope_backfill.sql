-- Round 4: backfill scoped columns on legacy parameter spec review tasks.

update parameter_spec_review_tasks t
set
  project_id = coalesce(
    nullif(t.project_id, ''),
    nullif(t.source_evidence->>'projectId', '')
  ),
  config_revision_id = coalesce(
    nullif(t.config_revision_id, ''),
    (
      select cr.id
      from dts_config_revisions cr
      where cr.id = nullif(t.source_evidence->>'configRevisionId', '')
      limit 1
    )
  ),
  property_occurrence_id = coalesce(
    nullif(t.property_occurrence_id, ''),
    (
      select po.id
      from dts_property_occurrences po
      where po.id = nullif(t.source_evidence->>'propertyOccurrenceId', '')
      limit 1
    )
  ),
  blocker_scope = case
    when coalesce(t.blocker_scope, 'revision') <> 'revision' then t.blocker_scope
    when coalesce(
      nullif(t.source_evidence->>'configRevisionId', ''),
      nullif(t.config_revision_id, '')
    ) is not null
      then 'revision'
    when coalesce(
      nullif(t.source_evidence->>'projectId', ''),
      nullif(t.project_id, '')
    ) is not null
      then 'project'
    else 'platform'
  end
where (
  (
    t.project_id is distinct from coalesce(
      nullif(t.project_id, ''),
      nullif(t.source_evidence->>'projectId', '')
    )
  )
  or (
    t.config_revision_id is distinct from coalesce(
      nullif(t.config_revision_id, ''),
      (
        select cr.id
        from dts_config_revisions cr
        where cr.id = nullif(t.source_evidence->>'configRevisionId', '')
        limit 1
      )
    )
  )
  or (
    t.property_occurrence_id is distinct from coalesce(
      nullif(t.property_occurrence_id, ''),
      (
        select po.id
        from dts_property_occurrences po
        where po.id = nullif(t.source_evidence->>'propertyOccurrenceId', '')
        limit 1
      )
    )
  )
  or (
    t.blocker_scope = 'revision'
    and coalesce(nullif(t.source_evidence->>'configRevisionId', ''), nullif(t.config_revision_id, '')) is null
    and coalesce(nullif(t.source_evidence->>'projectId', ''), nullif(t.project_id, '')) is null
    and coalesce(t.source_evidence->>'inferred', '') = 'true'
  )
);
