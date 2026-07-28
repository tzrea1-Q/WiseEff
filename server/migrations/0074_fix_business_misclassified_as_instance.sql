-- Correct 0072 step-(4) false positive: Title-case business categories whose
-- names happen to match the scaffolding prefix regex
-- `^(i2c|spi|pmic|batt|scharger)([@_0-9a-z]*)$` (case-insensitive).
-- Example: "Battery" matched as batt + ery and was marked instance/auto even
-- though it is a curated business parent of Battery Gauge / Protection / ….
--
-- Restore only rows that look like that misclassification:
--   - still instance/auto
--   - no source_key (true ingest instances usually have node:…)
--   - not targeted by an instance mapping
--   - already have business children (taxonomy parents)

update parameter_modules pm
set
  kind = 'business',
  origin = 'curated',
  source_key = null
where pm.kind = 'instance'
  and pm.origin = 'auto'
  and pm.source_key is null
  and not exists (
    select 1
    from parameter_module_mappings m
    where m.parameter_module_id = pm.id
      and m.match_kind = 'instance'
  )
  and exists (
    select 1
    from parameter_modules child
    where child.parent_id = pm.id
      and child.kind = 'business'
  );
