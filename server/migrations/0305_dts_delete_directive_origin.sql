-- #1420: a deletion is an original source directive, never a property occurrence.
-- Historical effects without an exact directive remain explicitly unlocated.
alter table public.dts_occurrence_effects add column source_directive jsonb
  check (source_directive is null or (
    effect_kind = 'delete' and property_occurrence_id is null
    and jsonb_typeof(source_directive) = 'object'
    and source_directive->>'kind' in ('delete-property', 'delete-node')
    and source_directive ?& array['fileVersionId','startOffset','endOffset','startLine','startColumn','endLine','endColumn','rawText','targetNodeLocator']
  ));
