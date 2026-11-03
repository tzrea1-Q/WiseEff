create or replace view parameter_catalog.registration_effective_module as
select registration.organization_id, registration.id as registration_id,
       registration.subject_id,
       case when subject.owner_subject_id is null then placement.module_id else owner_placement.module_id end as module_id,
       owner_registration.id as via_owner_registration_id
from parameter_catalog.organization_subject_registrations registration
join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
left join parameter_catalog.subject_placements placement
  on placement.id = registration.current_placement_id
 and placement.registration_id = registration.id
 and placement.organization_id = registration.organization_id
left join parameter_catalog.organization_subject_registrations owner_registration
  on owner_registration.organization_id = registration.organization_id
 and owner_registration.subject_id = subject.owner_subject_id
 and (owner_registration.status = 'active' or (registration.status = 'retired' and owner_registration.status = 'retired'))
left join parameter_catalog.subject_placements owner_placement
  on owner_placement.id = owner_registration.current_placement_id
 and owner_placement.registration_id = owner_registration.id
 and owner_placement.organization_id = owner_registration.organization_id;
