-- D-AG-04 / TD-046: driver registration default business category is the
-- authoritative auto-placement parent (real business leaf C). Keyword
-- businessCategoryForNodePath is seed/bootstrap-only after this migration.
--
-- Numbered 0089 after PR #219 landed 0088_parameter_spec_subject_required.

alter table driver_registrations
  add column if not exists default_business_category_module_id text
    references parameter_modules(id);

create index if not exists driver_registrations_default_business_category_idx
  on driver_registrations (default_business_category_module_id)
  where default_business_category_module_id is not null;

-- Backfill from existing driver-group placement when the parent is a real
-- business category (not unclassified / driver-group / node-type).
update driver_registrations dr
set default_business_category_module_id = pm.parent_id
from parameter_modules pm
inner join parameter_modules parent
  on parent.id = pm.parent_id
 and parent.organization_id = pm.organization_id
where pm.attribution_subject_id = dr.attribution_subject_id
  and pm.kind = 'driver-group'
  and parent.kind = 'business'
  and dr.default_business_category_module_id is null;
