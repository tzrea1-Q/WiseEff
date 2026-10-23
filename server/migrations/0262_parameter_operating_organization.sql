-- Resource authorization retains the real user's Home organization. A persisted,
-- active, organization-wide platform grant can administer an explicit target.
create or replace function parameter_catalog.require_project_erasure_admin(p_org text,p_actor text) returns void
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
 if not exists(select 1 from public.organizations where id=p_org)
   or not exists(select 1 from public.users u join public.user_role_bindings r
     on r.user_id=u.id and r.organization_id=u.organization_id
     where u.id=p_actor and u.is_active and r.project_id is null
       and (r.role_id='platform-admin' or (u.organization_id=p_org and r.role_id='admin')))
 then raise exception using errcode='42501',message='Current organization administrator is required'; end if;
end; $$;

-- Keep the installed inventory and its accumulated evidence domains intact.
do $$
declare installed text; changed text;
begin
 select pg_get_functiondef('parameter_catalog.preview_project_deletion_catalog(text,text,text)'::regprocedure) into strict installed;
 changed := replace(installed, $old$if not exists(select 1 from public.users u join public.user_role_bindings r
      on r.user_id=u.id and r.organization_id=u.organization_id
      where u.id=p_principal_id and u.organization_id=p_organization_id and u.is_active
        and r.project_id is null and r.role_id in ('admin','platform-admin')) then
    raise exception using errcode='42501', message='Organization administrator is required for project deletion preview';
  end if;$old$, 'perform parameter_catalog.require_project_erasure_admin(p_organization_id,p_principal_id);');
 if changed=installed then raise exception 'Project preview administrator guard is unavailable'; end if;
 execute changed;
end $$;

-- Reassignment/cancellation still require a same-transaction human audit and
-- an eligible target reviewer. Only the administrator may have a different Home.
do $$
declare installed text; changed text; old_role text; new_role text;
begin
 select pg_get_functiondef('parameter_catalog.protect_source_request_administration()'::regprocedure) into strict installed;
 changed := replace(installed,
   'administrator.id=audit.actor_user_id and administrator.organization_id=old.organization_id and administrator.is_active',
   'administrator.id=audit.actor_user_id and administrator.is_active');
 if changed=installed then raise exception 'Source administration actor guard is unavailable'; end if;
 old_role := $old$role.user_id=administrator.id and role.organization_id=old.organization_id
            and role.role_id in ('admin','platform-admin')$old$;
 new_role := $new$role.user_id=administrator.id and role.organization_id=administrator.organization_id
            and ((role.role_id='platform-admin' and role.project_id is null) or (administrator.organization_id=old.organization_id and role.role_id='admin'))$new$;
 if position(old_role in changed)=0 then raise exception 'Source administration role guard is unavailable'; end if;
 changed := replace(changed,old_role,new_role);
 execute changed;
end $$;
