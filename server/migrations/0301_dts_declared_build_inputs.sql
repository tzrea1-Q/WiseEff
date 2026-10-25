-- Local declarations remain separate from inputs owned by fixed shared revisions.
alter table public.shared_dtsi_drafts add column build_inputs jsonb not null
  default '{"includeSearchPaths":[],"defines":{}}'::jsonb;
alter table public.dts_config_revisions add column declared_build_inputs jsonb not null
  default '{"includeSearchPaths":[],"defines":{}}'::jsonb;

-- Before declared external macros existed, the retained include configuration is
-- the only proven local input. No global macro set is reverse-inferred as local.
update public.dts_config_revisions
  set declared_build_inputs=jsonb_build_object('includeSearchPaths',include_search_paths,'defines','{}'::jsonb);

alter table public.shared_dtsi_drafts add constraint shared_dtsi_draft_build_inputs_shape check (
  coalesce(jsonb_typeof(build_inputs)='object' and jsonb_typeof(build_inputs->'includeSearchPaths')='array'
    and jsonb_typeof(build_inputs->'defines')='object' and (build_inputs-'includeSearchPaths'-'defines')='{}'::jsonb,false));
alter table public.dts_config_revisions add constraint dts_declared_build_inputs_shape check (
  coalesce(jsonb_typeof(declared_build_inputs)='object' and jsonb_typeof(declared_build_inputs->'includeSearchPaths')='array'
    and jsonb_typeof(declared_build_inputs->'defines')='object' and (declared_build_inputs-'includeSearchPaths'-'defines')='{}'::jsonb,false));
