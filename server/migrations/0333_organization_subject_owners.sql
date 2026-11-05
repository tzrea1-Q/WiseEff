-- Organizational attribution is an explicit override. Catalog identities,
-- published ownership, Bindings and historical values stay unchanged.
alter table parameter_catalog.organization_subject_registrations
  add column owner_subject_id text references parameter_catalog.catalog_drivers(subject_id)
    on delete restrict deferrable initially deferred;
grant select (owner_subject_id) on parameter_catalog.organization_subject_registrations to wiseeff_mod_d02_source_reader;

create or replace view parameter_catalog.registration_effective_module as
select registration.organization_id, registration.id as registration_id,
       registration.subject_id,
       case when coalesce(registration.owner_subject_id, subject.owner_subject_id) is null
         then placement.module_id else owner_placement.module_id end as module_id,
       owner_registration.id as via_owner_registration_id
from parameter_catalog.organization_subject_registrations registration
join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
left join parameter_catalog.subject_placements placement
  on placement.id = registration.current_placement_id
 and placement.registration_id = registration.id
 and placement.organization_id = registration.organization_id
left join parameter_catalog.organization_subject_registrations owner_registration
  on owner_registration.organization_id = registration.organization_id
 and owner_registration.subject_id = coalesce(registration.owner_subject_id, subject.owner_subject_id)
 and (owner_registration.status = 'active' or (registration.status = 'retired' and owner_registration.status = 'retired'))
left join parameter_catalog.subject_placements owner_placement
  on owner_placement.id = owner_registration.current_placement_id
 and owner_placement.registration_id = owner_registration.id
 and owner_placement.organization_id = owner_registration.organization_id;

create function parameter_catalog.organization_subject_owner_conflicts(p_org text,p_subject text,p_owner text)
returns boolean language sql stable set search_path=pg_catalog,parameter_catalog as $$
  select exists(
    with names as (
      select subject.id,coalesce(registration.owner_subject_id,subject.owner_subject_id) as owner_id,
        coalesce(rule.node_type_name,membership.selector_snapshot->>'value',subject.canonical_key) as name
      from parameter_catalog.catalog_subjects subject
      join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
        and membership.release_id=(select current_catalog_release_id from parameter_catalog.catalog_state where singleton)
      left join parameter_catalog.organization_subject_registrations registration
        on registration.subject_id=subject.id and registration.organization_id=p_org
      left join public.registration_recognition_rules rule
        on rule.registration_id=registration.id and rule.organization_id=p_org
      where subject.kind='node-type'
      union all
      select subject.id,coalesce(registration.owner_subject_id,subject.owner_subject_id),alias.normalized_selector
      from parameter_catalog.catalog_subjects subject
      join parameter_catalog.catalog_release_subjects membership on membership.subject_id=subject.id
        and membership.release_id=(select current_catalog_release_id from parameter_catalog.catalog_state where singleton)
      join parameter_catalog.catalog_subject_aliases alias on alias.subject_id=subject.id
      join parameter_catalog.catalog_release_subject_aliases alias_membership on alias_membership.alias_id=alias.id
        and alias_membership.release_id=membership.release_id
      left join parameter_catalog.organization_subject_registrations registration
        on registration.subject_id=subject.id and registration.organization_id=p_org
      where subject.kind='node-type' and not exists(select 1 from public.registration_recognition_rules rule
        where rule.registration_id=registration.id and rule.organization_id=p_org)
    ) select 1 from names source join names target on target.name=source.name
      where source.id=p_subject and target.id<>p_subject and target.owner_id=p_owner
  )
$$;
alter function parameter_catalog.organization_subject_owner_conflicts(text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.organization_subject_owner_conflicts(text,text,text) from public;

create function parameter_catalog.assert_organization_subject_owner()
returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog as $$
declare registration parameter_catalog.organization_subject_registrations%rowtype;
  default_owner text; subject_kind text; effective_owner text; current_release_id_value text;
begin
  if tg_op='UPDATE' and new.owner_subject_id is not distinct from old.owner_subject_id
    and (new.status<>'active' or old.status='active') then return null; end if;
  select * into registration from parameter_catalog.organization_subject_registrations where id=new.id;
  if registration.owner_subject_id is null and (tg_op='INSERT' or old.owner_subject_id is null) then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(688004000041::bigint);
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('parameter-module-recognition:' || registration.organization_id,0));
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('subject-registration:' || registration.organization_id,0));
  select s.kind,s.owner_subject_id into subject_kind,default_owner
    from parameter_catalog.catalog_subjects s where s.id=registration.subject_id;
  if subject_kind is distinct from 'node-type' or default_owner is null then
    raise exception using errcode='23514',message='Only an owned node type can override its organization owner',
      constraint='organization_subject_owner_ck';
  end if;
  effective_owner := coalesce(registration.owner_subject_id,default_owner);
  select current_catalog_release_id into current_release_id_value from parameter_catalog.catalog_state where singleton;
  if not exists(select 1 from parameter_catalog.organization_subject_registrations owner
      join parameter_catalog.catalog_drivers driver on driver.subject_id=owner.subject_id
      join parameter_catalog.catalog_release_subjects membership on membership.subject_id=owner.subject_id
        and membership.release_id=current_release_id_value
      where owner.organization_id=registration.organization_id and owner.subject_id=effective_owner
        and (registration.status<>'active' or (owner.status='active' and membership.lifecycle='active'))) then
    raise exception using errcode='23514',message='Organization child owner must be registered and active when the child is active',
      constraint='organization_subject_owner_ck';
  end if;
  if parameter_catalog.organization_subject_owner_conflicts(registration.organization_id,registration.subject_id,effective_owner) then
    raise exception using errcode='23505',message='A node name or alias already exists under the organization driver',
      constraint='organization_subject_owner_selector_unique';
  end if;
  return null;
end $$;
alter function parameter_catalog.assert_organization_subject_owner() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_organization_subject_owner() from public;
create constraint trigger organization_subject_owner_valid after insert or update
  on parameter_catalog.organization_subject_registrations
  deferrable initially deferred
  for each row execute function parameter_catalog.assert_organization_subject_owner();

create function parameter_catalog.assert_registration_recognition_owner()
returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog as $$
declare org_id text; subject_id_value text; effective_owner text;
begin
  org_id := case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  perform pg_catalog.pg_advisory_xact_lock_shared(688004000041::bigint);
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('parameter-module-recognition:' || org_id,0));
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('subject-registration:' || org_id,0));
  select registration.subject_id,coalesce(registration.owner_subject_id,subject.owner_subject_id)
    into subject_id_value,effective_owner
    from parameter_catalog.organization_subject_registrations registration
    join parameter_catalog.catalog_subjects subject on subject.id=registration.subject_id
    where registration.id=case when tg_op='DELETE' then old.registration_id else new.registration_id end
      and registration.organization_id=org_id;
  if effective_owner is null then return null; end if;
  if parameter_catalog.organization_subject_owner_conflicts(org_id,subject_id_value,effective_owner) then
    raise exception using errcode='23505',message='A node name or alias already exists under the organization driver',
      constraint='organization_subject_owner_selector_unique';
  end if;
  return null;
end $$;
alter function parameter_catalog.assert_registration_recognition_owner() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_registration_recognition_owner() from public;
create constraint trigger registration_recognition_owner_valid after insert or update or delete
  on public.registration_recognition_rules deferrable initially deferred
  for each row execute function parameter_catalog.assert_registration_recognition_owner();

-- A new Catalog child, alias or reactivation can collide with an organization
-- override even before that new child is registered. Validate the complete
-- effective matcher, including retained retired subjects and aliases, while
-- the publisher still owns the current-pointer lock.
create function parameter_catalog.assert_catalog_organization_subject_owners()
returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog as $$
declare registration record;
begin
  if tg_op='UPDATE' and new.current_catalog_release_id is not distinct from old.current_catalog_release_id then return null; end if;
  for registration in
    select r.organization_id,r.subject_id,r.owner_subject_id
    from parameter_catalog.organization_subject_registrations r
    join parameter_catalog.catalog_state state on state.singleton
    join parameter_catalog.catalog_release_subjects membership
      on membership.release_id=state.current_catalog_release_id and membership.subject_id=r.subject_id
    where r.owner_subject_id is not null order by r.organization_id,r.subject_id
  loop
    if parameter_catalog.organization_subject_owner_conflicts(registration.organization_id,registration.subject_id,registration.owner_subject_id) then
      raise exception using errcode='23505',message='Catalog node names or aliases conflict with organization driver attribution',
        constraint='catalog_organization_subject_owner_selector_unique';
    end if;
  end loop;
  return null;
end $$;
alter function parameter_catalog.assert_catalog_organization_subject_owners() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_catalog_organization_subject_owners() from public;
create constraint trigger catalog_organization_subject_owners_valid after insert or update
  on parameter_catalog.catalog_state deferrable initially deferred
  for each row execute function parameter_catalog.assert_catalog_organization_subject_owners();

-- The existing source-scope proof already joins the exact organization
-- Registration. Apply the same effective owner to both exclusion and resumption.
do $migration$
declare definition text; needle constant text := 'identity.owner_subject_id';
begin
  select pg_get_functiondef('parameter_catalog.assert_source_managed_scope_receipt()'::regprocedure) into strict definition;
  if position(needle in definition)=0 then raise exception 'Source managed-scope owner proof is missing'; end if;
  execute replace(definition,needle,'coalesce(registration.owner_subject_id,identity.owner_subject_id)');
end $migration$;
