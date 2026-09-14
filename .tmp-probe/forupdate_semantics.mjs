import pg from "pg";
const url = process.env.DATABASE_URL;
const a = new pg.Client({ connectionString: url });
const b = new pg.Client({ connectionString: url });
await a.connect(); await b.connect();
await a.query(`drop schema if exists probe_lock cascade`);
await a.query(`create schema probe_lock`);
await a.query(`create table probe_lock.base (id text primary key, v text)`);
await a.query(`create table probe_lock.repl (old_id text, status text)`);
await a.query(`create view probe_lock.v as select x.* from probe_lock.base x where not exists (select 1 from probe_lock.repl r where r.status='completed' and r.old_id = x.id)`);
await a.query(`insert into probe_lock.base values ('b1','x'),('b2','y')`);
await a.query(`insert into probe_lock.repl values ('b2','completed')`);

const tryLock = async (client, label) => {
  try {
    const r = await client.query(`select id from probe_lock.v where id = $1 for update`, ['b1']);
    return { label, ok: true, rows: r.rowCount };
  } catch (e) { return { label, ok: false, code: e.code, msg: e.message }; }
};

// a holds lock via view
await a.query("begin");
console.log("A lock via view:", JSON.stringify(await tryLock(a, "A")));
// b tries to lock same base row directly
await b.query("begin");
await b.query("set local lock_timeout='800ms'");
console.log("B concurrent on base row:", JSON.stringify(await tryLock(b, "B")));

// replaced row: view must return 0 rows (so no lock contention)
await a.query("rollback");
await b.query("rollback");
await a.query("begin");
const repl = await a.query(`select id from probe_lock.v where id = $1 for update`, ['b2']);
console.log("replaced row via view rows:", repl.rowCount);
await b.query("begin");
await b.query("set local lock_timeout='800ms'");
try {
  await b.query(`select id from probe_lock.base where id='b2' for update nowait`);
  console.log("replaced row NOT locked by view (expected: view returned no row)");
} catch (e) { console.log("replaced row locked unexpectedly:", e.code); }
await a.query("rollback"); await b.query("rollback");
await a.query(`drop schema probe_lock cascade`);
await a.end(); await b.end();
