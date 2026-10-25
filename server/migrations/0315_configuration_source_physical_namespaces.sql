-- Preserve project-global legacy filename lookup. Canonical manifests retain
-- exact original paths while each configuration owns separate physical files.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_project_shared_dtsi_provenance()'::regprocedure) into strict installed;
  changed:=replace(installed,
    $old$(case when r.mount_path='' then m.source_name else r.mount_path||'/'||m.source_name end)=f.file_name$old$,
    $new$((case when r.mount_path='' then m.source_name else r.mount_path||'/'||m.source_name end)=f.file_name
      or 'initialization-'||r.config_set_id||'-'||(case when r.mount_path='' then m.source_name else r.mount_path||'/'||m.source_name end)=f.file_name)$new$);
  if changed=installed then raise exception 'Shared provenance physical filename marker unavailable'; end if;
  execute changed;

  select pg_get_functiondef('public.shared_dtsi_switch_allows_change(text,jsonb,jsonb,text)'::regprocedure) into strict installed;
  changed:=replace(installed,$old$member->>'sourceName'=new_row->>'file_name'$old$,
    $new$(member->>'sourceName'=new_row->>'file_name'
      or 'initialization-'||request.source_revision_config_set_id||'-'||(member->>'sourceName')=new_row->>'file_name')$new$);
  if changed=installed then raise exception 'Shared switch physical filename proof marker unavailable'; end if;
  execute changed;

  select pg_get_functiondef('public.apply_shared_dtsi_switch(text,jsonb)'::regprocedure) into strict installed;
  changed:=replace(installed,$old$file_name=member->>'sourceName'$old$,
    $new$file_name='initialization-'||r.source_revision_config_set_id||'-'||(member->>'sourceName')$new$);
  if changed=installed then raise exception 'Shared switch physical filename assignment marker unavailable'; end if;
  execute changed;
end $$;
