import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { access, copyInputs, type DockerRecoveryResources, type DockerRecoverySecrets } from "../dockerAccess";
import { hasUnsupportedNonDumpCapabilities } from "../recoveryPackage";
import { recoveryRefuse } from "../controlledRecovery";
import type { ControlledRecoveryTarget } from "./controlledRestore";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = (value: string) => pg.escapeLiteral(value);
// This is an empty vanilla PG16 target profile, not permission to overwrite a
// partially restored database. Include every relation kind and standalone user
// object: a table-only check misses executable functions and event triggers.
// 16384 is PostgreSQL's FirstNormalObjectId; checking both namespace and OID also
// rejects user objects placed inside an otherwise built-in namespace.
const EMPTY_TARGET_SQL = `select json_build_object(
 'relations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.oid>=16384 or n.nspname not in ('pg_catalog','information_schema','pg_toast')),
 'routines',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.oid>=16384 or n.nspname not in ('pg_catalog','information_schema')),
 'types',(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace
   where t.oid>=16384 or n.nspname not in ('pg_catalog','information_schema','pg_toast')),
 'schemas',(select count(*) from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast','public')),
 'extensions',(select count(*) from pg_extension where extname<>'plpgsql'),
 'missingPlpgsql',(select case when count(*)=1 then 0 else 1 end from pg_extension where extname='plpgsql'),
 'eventTriggers',(select count(*) from pg_event_trigger),
 'largeObjects',(select count(*) from pg_largeobject_metadata),
 'defaultAcls',(select count(*) from pg_default_acl),
 'foreignData',(select count(*) from pg_foreign_data_wrapper)+(select count(*) from pg_foreign_server)+(select count(*) from pg_user_mapping),
 'replicationObjects',(select count(*) from pg_publication)+(select count(*) from pg_subscription where subdbid=(select oid from pg_database where datname=current_database())),
 'casts',(select count(*) from pg_cast where oid>=16384),
 'collations',(select count(*) from pg_collation where oid>=16384),
 'languages',(select count(*) from pg_language where oid>=16384 or lanname not in ('internal','c','sql','plpgsql')),
 'operators',(select count(*) from pg_operator where oid>=16384)+(select count(*) from pg_opclass where oid>=16384)+(select count(*) from pg_opfamily where oid>=16384),
 'accessMethods',(select count(*) from pg_am where oid>=16384),
 'conversions',(select count(*) from pg_conversion where oid>=16384),
 'transforms',(select count(*) from pg_transform),
 'textSearch',(select count(*) from pg_ts_config where oid>=16384)+(select count(*) from pg_ts_dict where oid>=16384)
   +(select count(*) from pg_ts_parser where oid>=16384)+(select count(*) from pg_ts_template where oid>=16384),
 'roles',(select count(*) from pg_roles where rolname !~ '^pg_' and rolname<>'postgres')
) as inventory`;

export function createDockerRecoveryDestination(resources: DockerRecoveryResources, secrets: DockerRecoverySecrets): ControlledRecoveryTarget {
  ({ resources, secrets } = copyInputs(resources, secrets));
  const io = access(resources, secrets, false);
  return {
    observe: io.observe,
    async assertBootstrap(bootstrap) {
      if (!resources.bootstrap && !bootstrap) return;
      if (!resources.bootstrap || !bootstrap || digest(bootstrap) !== digest(resources.bootstrap)) recoveryRefuse("restore-bootstrap-mismatch");
      await io.db(async client => {
        await io.assertNoOtherSessions(client);
        if (hasUnsupportedNonDumpCapabilities(await io.inventory(client))) recoveryRefuse("restore-database-profile-unsupported");
      });
    },
    async assertEmptyAndIsolated() {
      await io.db(async client => {
        await io.assertNoOtherSessions(client);
        if (hasUnsupportedNonDumpCapabilities(await io.inventory(client))) recoveryRefuse("restore-database-profile-unsupported");
        const empty = (await client.query(resources.bootstrap ? EMPTY_TARGET_SQL.replaceAll("'postgres'", "$1::text") : EMPTY_TARGET_SQL,
          resources.bootstrap ? [io.adminName] : [])).rows[0]?.inventory;
        if (!empty || Object.values(empty).some(count => count !== 0)) recoveryRefuse("restore-database-not-empty");
      });
      if (io.list().length) recoveryRefuse("restore-bucket-not-empty");
      const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-empty-redis-"));
      try {
        io.docker.command(["cp", `${resources.redis.id}:/data/.`, directory]);
        if ((await readdir(directory)).length) recoveryRefuse("restore-redis-not-empty");
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async restorePostgres(backup) {
      if (resources.bootstrap || backup.bootstrap) {
        if (!resources.bootstrap || !backup.bootstrap || digest(resources.bootstrap) !== digest(backup.bootstrap)) recoveryRefuse("restore-bootstrap-mismatch");
      }
      if (backup.roles.some(role => role.login && (!secrets.rolePasswords?.[role.name] || secrets.rolePasswords[role.name].includes("\0")))) recoveryRefuse("restore-role-secret-unavailable");
      await io.db(async client => {
        await client.query("begin");
        try {
          // Only this controlled bootstrap session changes logging. Password
          // statements must not enter even a locally enabled SQL-duration log.
          await client.query("set local log_statement='none'; set local log_min_error_statement='panic'; set local log_min_duration_statement=-1; set local log_min_duration_sample=-1");
          // Package verification has already restricted names and capabilities.
          for (const role of backup.roles) {
            const password = role.login ? secrets.rolePasswords?.[role.name] : undefined;
            if (role.login && (!password || password.includes("\0"))) recoveryRefuse("restore-role-secret-unavailable");
            await client.query(`create role "${role.name}" ${role.login ? `login password ${quote(password!)}` : "nologin"} ${role.inherit ? "inherit" : "noinherit"} nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
          }
          for (const role of backup.roles) for (const member of role.members) {
            await client.query(`grant "${role.name}" to "${member.name}" with admin false`);
            await client.query(`grant "${role.name}" to "${member.name}" with inherit ${member.inherit}`);
            await client.query(`grant "${role.name}" to "${member.name}" with set ${member.set}`);
          }
          await client.query("commit");
        } catch { await client.query("rollback").catch(() => {}); recoveryRefuse("restore-role-outcome-unknown"); }
      });
      io.exec(resources.postgres, ["pg_restore", "-U", io.adminName, "-d", resources.database, "--exit-on-error"], backup.postgres);
    },
    async restoreObjects(objects) {
      for (const object of objects) await io.store().put({ bucket: resources.bucket, ...object });
    },
    async restoreRedis(redis) {
      io.check();
      const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-redis-import-"));
      try {
        for (const file of redis.files) await writeFile(path.join(directory, file.name), file.bytes, { flag: "wx", mode: 0o600 });
        io.check();
        io.docker.command(["cp", directory, `${resources.redis.id}:/data/appendonlydir`]);
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}
