-- Local declarations remain separate from inputs owned by fixed shared revisions.
alter table public.shared_dtsi_drafts add column build_inputs jsonb not null
  default '{"includeSearchPaths":[],"defines":{}}'::jsonb;
alter table public.dts_config_revisions add column declared_build_inputs jsonb not null
  default '{"includeSearchPaths":[],"defines":{}}'::jsonb;

-- Before declared external macros existed, the retained include configuration is
-- the only proven local input. No global macro set is reverse-inferred as local.
do $$
declare
  guard record;
  guards jsonb := '[]'::jsonb;
begin
  -- ALTER TABLE holds the migration's exclusive table lock. Backfill only this
  -- new metadata, without replaying immutable-source or historical-row guards.
  -- As in 0259, restore each original mode within the same migration transaction.
  for guard in select tgname,tgenabled::text as enabled from pg_trigger
    where tgrelid='public.dts_config_revisions'::regclass and not tgisinternal and tgenabled <> 'D'
    order by tgname
  loop
    guards := guards || jsonb_build_array(jsonb_build_object('name',guard.tgname,'enabled',guard.enabled));
    execute format('alter table public.dts_config_revisions disable trigger %I',guard.tgname);
  end loop;
  update public.dts_config_revisions
    set declared_build_inputs=jsonb_build_object('includeSearchPaths',include_search_paths,'defines','{}'::jsonb);
  for guard in select * from jsonb_to_recordset(guards) as modes(name text,enabled text) loop
    execute format('alter table public.dts_config_revisions enable %strigger %I',
      case guard.enabled when 'A' then 'always ' when 'R' then 'replica ' else '' end,guard.name);
  end loop;
end $$;

alter table public.shared_dtsi_drafts add constraint shared_dtsi_draft_build_inputs_shape check (
  coalesce(jsonb_typeof(build_inputs)='object' and jsonb_typeof(build_inputs->'includeSearchPaths')='array'
    and jsonb_typeof(build_inputs->'defines')='object' and (build_inputs-'includeSearchPaths'-'defines')='{}'::jsonb,false));
alter table public.dts_config_revisions add constraint dts_declared_build_inputs_shape check (
  coalesce(jsonb_typeof(declared_build_inputs)='object' and jsonb_typeof(declared_build_inputs->'includeSearchPaths')='array'
    and jsonb_typeof(declared_build_inputs->'defines')='object' and (declared_build_inputs-'includeSearchPaths'-'defines')='{}'::jsonb,false));
