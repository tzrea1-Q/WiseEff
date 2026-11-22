-- Current-instance validation finds the pinned effect and checks that no
-- later effect superseded it on the same logical node and property.
create index if not exists dts_occurrence_effects_pinned_property_idx
  on public.dts_occurrence_effects (property_occurrence_id, config_revision_id);

create index if not exists dts_occurrence_effects_node_property_order_idx
  on public.dts_occurrence_effects (config_revision_id, logical_node_revision_id, property_name, source_order);
