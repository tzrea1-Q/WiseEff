import pg from "pg";
const url = process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();
const q = async (label, sql) => {
  try {
    const r = await client.query(sql);
    console.log(`OK   [${label}] rows=${r.rowCount} cmd=${r.command}`);
  } catch (e) {
    console.log(`FAIL [${label}] code=${e.code} msg=${e.message}`);
  }
};
await q("view exists", "select 1 from parameter_catalog.current_project_parameter_bindings limit 1");
await q("view for update", "select binding.id from parameter_catalog.current_project_parameter_bindings binding limit 1 for update");
await q("view for share", "select binding.id from parameter_catalog.current_project_parameter_bindings binding limit 1 for share");
await q("base inline current for update", "select binding.id from parameter_catalog.project_parameter_bindings binding where binding.id = 'nonexistent' and not parameter_catalog.is_replaced_current_binding(binding.id) for update");
await q("is_replaced_current_binding", "select parameter_catalog.is_replaced_current_binding('x')");
await q("resolve_current_binding", "select parameter_catalog.resolve_current_binding('p','n','d')");
await q("view select *", "select binding.* from parameter_catalog.current_project_parameter_bindings binding limit 1");
await client.end();
