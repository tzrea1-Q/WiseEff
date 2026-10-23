-- No member-management writes existed before this cutover. Reconcile the snapshot
-- taken by 0266 with current grants, including intervening projects and revocations.
lock table public.projects, public.users, public.user_role_bindings, public.project_members in share row exclusive mode;
delete from public.project_members;
insert into public.project_members(organization_id, project_id, user_id, roles)
select p.organization_id, p.id, u.id, array_agg(distinct b.role_id order by b.role_id)
from public.projects p
join public.users u on u.organization_id = p.organization_id
join public.user_role_bindings b on b.user_id=u.id and b.organization_id=u.organization_id
  and (b.project_id is null or b.project_id=p.id)
where b.role_id in ('hardware-user','software-user','hardware-committer','software-committer')
group by p.organization_id,p.id,u.id;
