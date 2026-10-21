-- Historical decisions intentionally remain unknown: today's activation/roles
-- cannot establish what an old rejection actually did.
alter table public.local_registration_role_requests
  add column account_changed_at timestamptz,
  add column decision_outcome text check (decision_outcome in
    ('requested-role-enabled','basic-enabled','rejected-disabled','rejected-preserved')),
  add column decision_can_login boolean,
  add column decision_role_ids text[];

-- Known subsequent management actions make a surviving pending request stale.
update public.local_registration_role_requests requests
set account_changed_at = changes.changed_at
from (
  select requests.id, max(events.created_at) as changed_at
  from public.local_registration_role_requests requests
  join public.audit_events events on events.target_id = requests.user_id
    and events.kind in ('user-activation','user-role-replace')
    and events.created_at >= requests.created_at
  where requests.status = 'pending'
  group by requests.id
) changes
where requests.id = changes.id;

create function public.mark_pending_registration_account_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare target record;
begin
  if TG_TABLE_NAME = 'users' then
    update public.local_registration_role_requests
    set account_changed_at = statement_timestamp()
    where user_id = new.id and organization_id = new.organization_id and status = 'pending';
    return new;
  end if;
  for target in
    select distinct changed.user_id, changed.organization_id
    from (values
      (old.user_id, old.organization_id, old.project_id, old.role_id),
      (new.user_id, new.organization_id, new.project_id, new.role_id)
    ) changed(user_id,organization_id,project_id,role_id)
    where changed.user_id is not null and changed.project_id is null
      and changed.role_id not like 'catalog-capability-%'
    order by changed.user_id, changed.organization_id
  loop
    -- Match governance's user -> request lock order, including direct role writes.
    perform id from public.users where id = target.user_id for no key update;
    update public.local_registration_role_requests
    set account_changed_at = statement_timestamp()
    where user_id = target.user_id and organization_id = target.organization_id and status = 'pending';
  end loop;
  return null;
end;
$$;

create trigger registration_activation_changed after update of is_active on public.users
for each row execute function public.mark_pending_registration_account_change();
create trigger registration_organization_roles_changed after insert or delete or update on public.user_role_bindings
for each row execute function public.mark_pending_registration_account_change();
