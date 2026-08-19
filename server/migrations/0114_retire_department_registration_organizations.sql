-- Reassign leftover local-registration membership from retired department
-- Organizations onto ChargeLab when that Evaluation Organization exists.
-- Department Organization rows stay (OIDC claims with those ids are still
-- Organizations; login does not remap them).

do $$
declare
  home_org_id text;
  source_org_id text;
begin
  select id into home_org_id
  from organizations
  where id = 'org-chargelab'
  limit 1;

  if home_org_id is null then
    return;
  end if;

  for source_org_id in
    select id
    from organizations
    where id in ('org-hardware-department', 'org-software-department')
  loop
    update users
    set organization_id = home_org_id
    where organization_id = source_org_id;

    update user_role_bindings
    set organization_id = home_org_id
    where organization_id = source_org_id;

    update auth_sessions
    set organization_id = home_org_id
    where organization_id = source_org_id;

    update local_registration_role_requests
    set organization_id = home_org_id
    where organization_id = source_org_id;
  end loop;
end;
$$;
