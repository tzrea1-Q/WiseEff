insert into organizations (id, name)
values
  ('org-hardware-department', '硬件部'),
  ('org-software-department', '软件部')
on conflict (id) do update set name = excluded.name;

do $$
declare
  mapping record;
  source_org_id text;
  target_org_id text;
begin
  for mapping in
    select * from (values
      ('硬件部', 'org-hardware-department'),
      ('软件部', 'org-software-department')
    ) as local_departments(name, id)
  loop
    for source_org_id in
      select id
      from organizations
      where name = mapping.name
        and id <> mapping.id
    loop
      target_org_id := mapping.id;

      update users
      set organization_id = target_org_id
      where organization_id = source_org_id;

      update user_role_bindings
      set organization_id = target_org_id
      where organization_id = source_org_id;

      update auth_sessions
      set organization_id = target_org_id
      where organization_id = source_org_id;

      update local_registration_role_requests
      set organization_id = target_org_id
      where organization_id = source_org_id;

      update audit_events
      set organization_id = target_org_id
      where organization_id = source_org_id;
    end loop;
  end loop;
end;
$$;
