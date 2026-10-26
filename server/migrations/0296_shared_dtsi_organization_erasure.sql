-- Shared source is Organization-owned, including immutable published history.
-- Keep the existing fail-closed discovery for every other unknown relation.
grant select,delete on public.shared_dtsi_resources,public.shared_dtsi_members,
  public.shared_dtsi_drafts,public.shared_dtsi_draft_members,public.shared_dtsi_revisions,
  public.shared_dtsi_revision_members,public.shared_dtsi_publication_previews to catalog_migration_owner;

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'for target in select * from (values', $inventory$for target in select * from (values
    ('public.project_shared_dtsi_references','projects','r.organization_id=$1'),
    ('public.project_shared_dtsi_snapshots','projects','r.reference_id in(select id from public.project_shared_dtsi_references where organization_id=$1)'),
    ('public.shared_dtsi_resources','organization-parameters','r.organization_id=$1'),
    ('public.shared_dtsi_members','organization-parameters','r.organization_id=$1'),
    ('public.shared_dtsi_drafts','organization-parameters','r.organization_id=$1'),
    ('public.shared_dtsi_draft_members','organization-parameters','r.organization_id=$1'),
    ('public.shared_dtsi_revisions','organization-parameters','r.organization_id=$1'),
    ('public.shared_dtsi_revision_members','organization-parameters','r.organization_id=$1'),
    ('public.shared_dtsi_publication_previews','organization-parameters','r.organization_id=$1'),$inventory$);
  if changed=installed then raise exception 'Organization ownership inventory seam was not found'; end if;
  execute changed;
end $$;

-- Reuse the trusted eraser's exact-primary-key capabilities and deletion loop.
-- Every child is marked before a parent cascade can reach it.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.purge_organization_parameter_assets(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.',
    $locks$  lock table public.shared_dtsi_resources,public.shared_dtsi_members,
    public.shared_dtsi_drafts,public.shared_dtsi_draft_members,public.shared_dtsi_revisions,
    public.shared_dtsi_revision_members,public.shared_dtsi_publication_previews in share row exclusive mode;
  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.$locks$);
  if changed=installed then raise exception 'Organization erasure closure fence seam was not found'; end if;
  installed:=changed;
  changed:=replace(installed,'for entry in select * from (values', $closure$for entry in select * from (values
    ('public.shared_dtsi_publication_previews','organization_id=$1'),
    ('public.shared_dtsi_revision_members','organization_id=$1'),
    ('public.shared_dtsi_revisions','organization_id=$1'),
    ('public.shared_dtsi_draft_members','organization_id=$1'),
    ('public.shared_dtsi_drafts','organization_id=$1'),
    ('public.shared_dtsi_members','organization_id=$1'),
    ('public.shared_dtsi_resources','organization_id=$1'),$closure$);
  if changed=installed then raise exception 'Organization erasure ownership closure seam was not found'; end if;
  execute changed;
end $$;

create or replace function public.guard_shared_dtsi_revision() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='DELETE' and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),'DELETE') then return OLD; end if;
  raise exception using errcode='55000',message='Published shared DTSI source is immutable';
end $$;

-- A live Organization erasure lease AND the exact row capability are required
-- to cross the deleting fence. Runtime roles cannot manufacture capabilities.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed,'if tg_op=''DELETE'' and ((tg_table_schema=', $guard$if tg_op='DELETE' and tg_table_schema='public'
          and tg_table_name=any(array['shared_dtsi_resources','shared_dtsi_members','shared_dtsi_drafts','shared_dtsi_draft_members',
            'shared_dtsi_revisions','shared_dtsi_revision_members','shared_dtsi_publication_previews','project_shared_dtsi_references'])
          and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,old_value,'DELETE') then return old; end if;
        if tg_op='DELETE' and ((tg_table_schema=$guard$);
  if changed=installed then raise exception 'Organization erasure lifecycle seam was not found'; end if;
  execute changed;
end $$;
