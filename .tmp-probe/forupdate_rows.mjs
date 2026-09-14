import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const n = await client.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings");
console.log("base rows:", n.rows[0].n);
if (n.rows[0].n === 0) { console.log("no rows; skipping lock behavior test"); await client.end(); process.exit(0); }
const id = (await client.query("select id from parameter_catalog.project_parameter_bindings limit 1")).rows[0].id;
// two connections: one locks via view, other tries for update nowait
const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
await other.connect();
await client.query("begin");
const locked = await client.query("select binding.id from parameter_catalog.current_project_parameter_bindings binding where binding.id = $1 for update", [id]);
console.log("view lock rows:", locked.rowCount);
try {
  await other.query("begin");
  await other.query("set local lock_timeout = '1000ms'");
  await other.query("select binding.id from parameter_catalog.current_project_parameter_bindings binding where binding.id = $1 for update", [id]);
  console.log("BLOCK CHECK: other acquired lock too -> view lock did NOT lock base row (BAD)");
} catch (e) {
  console.log(`BLOCK CHECK: other blocked/failed as expected code=${e.code} msg=${e.message}`);
}
await other.query("rollback").catch(()=>{});
await client.query("rollback");
// now: replaced row should be excluded by the view even under for update (no row -> no lock)
await client.end(); await other.end();
