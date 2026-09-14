import { createEphemeralTestDatabase } from "../server/testing/testDatabase";
(async () => {
  const eph = await createEphemeralTestDatabase("mig0144");
  console.log("URL", eph.url);
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: eph.url });
  await c.connect();
  const r = await c.query(`select relname, relkind from pg_class where relnamespace='parameter_catalog'::regnamespace and relname in ('definition_replacements','definition_replacement_projects','definition_replacement_previews','current_project_parameter_bindings') order by relname`);
  console.log(r.rows);
  const t = await c.query(`select tgname from pg_trigger where tgrelid='parameter_catalog.definition_replacements'::regclass order by tgname`);
  console.log(t.rows);
  const v = await c.query(`select count(*)::int as n from parameter_catalog.current_project_parameter_bindings`);
  console.log("view ok", v.rows);
  await c.end();
  await eph.drop();
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
