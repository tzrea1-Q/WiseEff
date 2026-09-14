import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (label, sql, vals=[]) => {
  try { const r = await c.query(sql, vals); console.log(`OK   [${label}] rows=${r.rowCount}`); }
  catch (e) { console.log(`FAIL [${label}] code=${e.code} msg=${e.message}`); }
};
await c.query("begin");
await q("loadBindingById view update", `select id, organization_id, catalog_release_id, project_id, logical_node_id,
        registration_id, subject_id, definition_id, effective_revision_id, current_value_id
   from parameter_catalog.current_project_parameter_bindings
  where id = $1 for update`, ["x"]);
await q("loadBindingReplacementState", `select parameter_catalog.is_replaced_current_binding($1) as replaced`, ["x"]);
await q("casCurrentTip", `update parameter_catalog.project_parameter_bindings
    set current_value_id = $3, updated_at = now()
  where id = $1 and current_value_id = $2
    and not parameter_catalog.is_replaced_current_binding(id)`, ["x","y","z"]);
await q("loadBindingByComposite", `select id, organization_id, catalog_release_id, project_id, logical_node_id,
        registration_id, subject_id, definition_id, effective_revision_id, current_value_id
   from parameter_catalog.project_parameter_bindings
  where id = parameter_catalog.resolve_current_binding($1, $2, $3)
  for update`, ["p","n","d"]);
await q("usage", `select binding.definition_id, count(distinct binding.project_id)::text as project_count
   from parameter_catalog.current_project_parameter_bindings binding
   left join parameter_catalog.project_parameter_values value on value.id = binding.current_value_id
  where binding.organization_id = $1 and binding.definition_id = any($2::text[])
  group by binding.definition_id`, ["o", ["d"]]);
await q("findCatalogBindingRow", `select id from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2 and id=$3 limit 1`, ["o","p","b"]);
await c.query("rollback");
await c.end();
