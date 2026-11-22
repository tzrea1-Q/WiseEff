-- A preview looks up an historical spelling across subjects. Index only the
-- bounded hash of the spelling; hash collisions conservatively trigger a
-- full-history check. The second column permits range probes on either side
-- of the current subject without walking repeated memberships of that subject.
create index catalog_release_subjects_preview_spelling_idx
  on parameter_catalog.catalog_release_subjects
  (md5(coalesce(selector_snapshot->'values'->>0, selector_snapshot->>'value')), subject_id);
