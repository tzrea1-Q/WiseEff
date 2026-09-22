-- Issue #898: retain legacy reload history while pinning new runs to the
-- canonical Binding / DefinitionRevision / ProjectValue / DTS source graph.
--
-- Existing rows are intentionally left untouched.  New rows use the nullable
-- legacy binding_id only as a historical compatibility column and persist the
-- canonical identity beside it.

alter table public.dts_reload_run_targets
  add column if not exists canonical_binding_id text,
  add column if not exists canonical_definition_id text,
  add column if not exists canonical_definition_revision_id text,
  add column if not exists canonical_current_value_id text,
  add column if not exists canonical_catalog_release_id text,
  add column if not exists canonical_source_pin_id text,
  add column if not exists canonical_source_occurrence_id text,
  add column if not exists canonical_config_revision_id text,
  add column if not exists canonical_source_ref text,
  add column if not exists canonical_source_format text,
  add column if not exists canonical_source_locator jsonb;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_format_ck
  check (canonical_source_format is null or canonical_source_format = 'dts');

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_identity_ck
  check (
    (
      canonical_binding_id is null
      and canonical_definition_id is null
      and canonical_definition_revision_id is null
      and canonical_current_value_id is null
      and canonical_catalog_release_id is null
      and canonical_source_pin_id is null
      and canonical_source_occurrence_id is null
      and canonical_config_revision_id is null
      and canonical_source_ref is null
      and canonical_source_format is null
      and canonical_source_locator is null
    )
    or
    (
      binding_id is null
      and canonical_binding_id is not null
      and canonical_definition_id is not null
      and canonical_definition_revision_id is not null
      and canonical_current_value_id is not null
      and canonical_catalog_release_id is not null
      and canonical_source_pin_id is not null
      and canonical_source_occurrence_id is not null
      and canonical_config_revision_id is not null
      and canonical_source_ref is not null
      and canonical_source_format = 'dts'
      and canonical_source_locator is not null
    )
  );

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_binding_fk
  foreign key (canonical_binding_id)
  references parameter_catalog.project_parameter_bindings(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_definition_fk
  foreign key (canonical_definition_id)
  references parameter_catalog.parameter_definitions(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_revision_fk
  foreign key (canonical_definition_revision_id)
  references parameter_catalog.definition_revisions(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_value_fk
  foreign key (canonical_current_value_id)
  references parameter_catalog.project_parameter_values(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_release_fk
  foreign key (canonical_catalog_release_id)
  references parameter_catalog.catalog_releases(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_source_pin_fk
  foreign key (canonical_source_pin_id)
  references parameter_catalog.project_value_source_pins(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_source_occurrence_fk
  foreign key (canonical_source_occurrence_id)
  references parameter_catalog.project_parameter_source_occurrences(id)
  on delete restrict;

alter table public.dts_reload_run_targets
  add constraint dts_reload_run_targets_canonical_config_revision_fk
  foreign key (canonical_config_revision_id)
  references public.dts_config_revisions(id)
  on delete restrict;

create unique index if not exists dts_reload_run_targets_canonical_identity_uk
  on public.dts_reload_run_targets (reload_run_id, canonical_binding_id)
  where canonical_binding_id is not null;

