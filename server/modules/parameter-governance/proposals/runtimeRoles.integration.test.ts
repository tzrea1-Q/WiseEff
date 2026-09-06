import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { CatalogReleaseDigest, CatalogSubjectId, DefinitionProposalId, DefinitionRevisionId, ParameterDefinitionId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { executeProposal } from "./service";
import type { CreateDraftProposalCommand } from "./command";
import { lockDestinationModule } from "../registration/repositories";
import { withProposalUnitOfWork } from "./unitOfWork";
import { CURRENT_POINTER_LOCK_KEY, lockAndLoadCurrentRelease } from "./repositories";
import { executeRegistration } from "../registration/service";
import type { RegisterSubjectCommand } from "../registration/command";

describe.skipIf(!process.env.UPG_RUNTIME_DOCKER_DAEMON_ID)("real isolated Catalog reader and governance logins", () => {
  const name = `wiseeff-upg-proposals-${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>;
  let id = "";
  let port = "";
  let admin: pg.Pool;
  let writer: pg.Pool;
  let reader: pg.Pool;
  let wrongReader: pg.Pool;
  let pin: CatalogReleasePin;
  let unrelatedFunctionAcl: unknown;
  let prepared = false;
  const url = (role: string, database = "postgres") => `postgres://${role}:${password}@127.0.0.1:${port}/${database}`;
  const command = (overrides: Partial<CreateDraftProposalCommand> = {}): CreateDraftProposalCommand => ({
    kind: "create-draft", organizationId: "role-org-1", baseRelease: pin, currentRelease: pin,
    baseDefinitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
    baseDefinitionRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_1"),
    payload: { reason: "isolated proposed value" }, reason: "synthetic role regression", evidenceRefs: [],
    idempotencyKey: randomBytes(12).toString("hex"), context: { actorKind: "org-admin", principalId: "isolated-author" }, ...overrides,
  });
  beforeAll(async () => {
    docker = createIsolatedUpgradeDocker();
    if (docker.command(["info", "--format", "{{.ID}}|{{.Name}}|{{.OperatingSystem}}"] ).toString().trim() !== `${process.env.UPG_RUNTIME_DOCKER_DAEMON_ID}|docker-desktop|Docker Desktop`) throw new Error("explicit development daemon identity mismatch");
    id = docker.command(["run", "-d", "--name", name, "--label", `wiseeff.test=${name}`, "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", "postgres:16-alpine"]).toString().trim();
    docker.assertOwned(id, "wiseeff.test", name);
    console.info("Synthetic capability target", JSON.stringify({ daemonId: process.env.UPG_RUNTIME_DOCKER_DAEMON_ID,
      containerId: id, postgresImageId: docker.command(["inspect", "--format", "{{.Image}}", id]).toString().trim(),
      mode: "isolated-capability-proposal-evaluation", productionApproval: false }));
    port = docker.command(["inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', id]).toString().trim();
    for (let attempt = 0; attempt < 30; attempt++) {
      const client = new pg.Client({ connectionString: url("postgres") });
      try { await client.connect(); await client.query("select 1"); await client.end(); break; }
      catch { await client.end().catch(() => undefined); await setTimeout(200); }
    }
    admin = new pg.Pool({ connectionString: url("postgres") });
    unrelatedFunctionAcl = (await admin.query("select proacl::text as acl from pg_proc where oid='pg_catalog.pg_postmaster_start_time()'::regprocedure")).rows[0].acl;
    const prepare = async (database: string) => {
      const db = createPostgresDatabase(url("postgres", database));
      try { await applyMigrations(db, path.resolve("server/migrations")); }
      finally { await db.close(); }
    };
    await prepare("postgres");
    await admin.query("create database wrong_reader_database");
    await prepare("wrong_reader_database");
    await admin.query(`create role scoped_reader login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole inherit;
      create role scoped_writer login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole inherit;
      grant catalog_runtime_reader_role to scoped_reader;
      grant parameter_governance_writer_role to scoped_writer;`);
    reader = new pg.Pool({ connectionString: url("scoped_reader") });
    writer = new pg.Pool({ connectionString: url("scoped_writer") });
    wrongReader = new pg.Pool({ connectionString: url("scoped_reader", "wrong_reader_database") });
    const complete = validCatalogReleaseBundle();
    const first = complete.releases[0]!;
    const bundle = { schemaVersion: complete.schemaVersion, targetReleaseId: first.manifest.release.id, releases: [first] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error("owned Catalog fixture compilation failed");
    pin = { id: compiled.value.model.releases[0]!.release.id, digest: compiled.value.model.releases[0]!.release.digest };
    expect(await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: pin.digest })).toMatchObject({ ok: true });
    await admin.query("insert into public.organizations(id,name) values ('role-org-1','Synthetic One'),('role-org-2','Synthetic Two')");
    await admin.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin) values ('role-module','role-org-1','Synthetic module','role-module',1,'business','curated')");
    await admin.query("insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values ('role-driver','role-org-1','driver-registration','Synthetic Driver','compatible:acme,power')");
    await admin.query("insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('role-driver','physical-device','multiple')");
    await admin.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values ('role-driver-module','role-org-1','Synthetic driver','role-driver-module',1,'driver-group','curated','role-driver')");
    prepared = true;
  }, 60000);
  afterAll(async () => {
    await Promise.all([admin?.end(), writer?.end(), reader?.end(), wrongReader?.end()]);
    if (id) {
      docker.assertOwned(id, "wiseeff.test", name);
      if (!prepared) console.warn("Owned PostgreSQL setup failed", docker.command(["inspect", "--format", "{{.State.Status}}|oom={{.State.OOMKilled}}|exit={{.State.ExitCode}}|restarts={{.RestartCount}}", id]).toString().trim());
      docker.command(["rm", "-f", "-v", id]);
    }
  });
  it("preserves writer/reader negative grants and fixed definer ownership/search_path", async () => {
    expect((await reader.query("select session_user as login")).rows).toEqual([{ login: "scoped_reader" }]);
    expect((await writer.query("select session_user as login")).rows).toEqual([{ login: "scoped_writer" }]);
    await expect(writer.query("select * from parameter_catalog.catalog_state")).rejects.toMatchObject({ code: "42501" });
    await expect(writer.query("select * from public.audit_events")).rejects.toMatchObject({ code: "42501" });
    await expect(reader.query("delete from parameter_catalog.catalog_releases")).rejects.toMatchObject({ code: "42501" });
    await expect(reader.query("create table public.forbidden_runtime_table(id text)")).rejects.toMatchObject({ code: "42501" });
    expect((await reader.query("select rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_catalog.pg_roles where rolname=session_user")).rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false }]);
    for (const role of ["catalog_migration_owner", "catalog_synchronizer_role", "parameter_governance_writer_role"]) {
      await expect(reader.query(`set role ${role}`)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(reader.query("select * from pg_catalog.pg_control_system()")).rejects.toMatchObject({ code: "42501" });
    await expect(writer.query("select parameter_catalog.read_proposal_success_audit('x','x','x','x')")).rejects.toMatchObject({ code: "42501" });
    await expect(reader.query("select * from parameter_catalog.lock_governance_destination_module('role-org-1','role-module')")).rejects.toMatchObject({ code: "42501" });
    expect((await admin.query("select proacl::text as acl from pg_proc where oid='pg_catalog.pg_postmaster_start_time()'::regprocedure")).rows[0].acl).toBe(unrelatedFunctionAcl);
    expect((await admin.query("select has_function_privilege('catalog_migration_owner','pg_catalog.pg_control_system()','EXECUTE') as allowed")).rows).toEqual([{ allowed: true }]);
    expect((await reader.query("select parameter_catalog.runtime_database_identity() as identity")).rows[0].identity).toMatch(/^\d+:\d+$/);
    const functions = await admin.query("select p.proname,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='parameter_catalog' and p.proname=any($1::text[]) order by p.proname", [["runtime_database_identity", "read_proposal_success_audit", "lock_governance_destination_module"]]);
    expect(functions.rows).toHaveLength(3);
    for (const fn of functions.rows) expect(fn).toMatchObject({ owner: "catalog_migration_owner", prosecdef: true, proconfig: ["search_path=pg_catalog"] });
  });
  it("commits and replays a real audited Proposal using two restricted login sessions", async () => {
    const input = command();
    const result = await executeProposal(writer, input, { readerPool: reader });
    expect(result).toMatchObject({ ok: true, value: { status: "draft", baseDefinitionId: "pdef_acme_power_iin_max", requestedChange: input.payload } });
    if (!result.ok) throw new Error("proposal failed");
    expect(await executeProposal(writer, input, { readerPool: reader })).toMatchObject({ ok: true, value: { outcome: "replayed", proposalId: result.value.proposalId } });
    expect((await admin.query("select count(*)::int as count from public.audit_events where target_id=$1 and action='proposal-create-draft'", [result.value.proposalId])).rows).toEqual([{ count: 1 }]);
    const crossOrganization = await executeProposal(writer, { kind: "submit-existing", organizationId: "role-org-2", proposalId: DefinitionProposalId(result.value.proposalId), expectedEtag: 1, currentRelease: pin, idempotencyKey: randomBytes(12).toString("hex"), context: input.context }, { readerPool: reader });
    expect(crossOrganization).toMatchObject({ ok: false, error: { kind: "proposal-not-found" } });
    expect((await admin.query("select status from parameter_catalog.definition_proposals where id=$1", [result.value.proposalId])).rows).toEqual([{ status: "draft" }]);
    expect((await admin.query("select count(*)::int as count from public.audit_events where organization_id='role-org-2' and action='proposal-submit-existing-refused' and target_id=$1", [result.value.proposalId])).rows).toEqual([{ count: 1 }]);
    const refusal = (await admin.query("select trace_id from public.audit_events where organization_id='role-org-2' and action='proposal-submit-existing-refused' and target_id=$1", [result.value.proposalId])).rows[0];
    expect((await reader.query("select parameter_catalog.read_proposal_success_audit($1,$2,$3,$4) as metadata", ["role-org-2", "proposal-submit-existing-refused", refusal.trace_id, result.value.proposalId])).rows).toEqual([{ metadata: null }]);
    const audit = (await admin.query("select trace_id from public.audit_events where action='proposal-create-draft' and target_id=$1", [result.value.proposalId])).rows[0];
    const visible = (await reader.query("select parameter_catalog.read_proposal_success_audit($1,$2,$3,$4) as metadata", ["role-org-1", "proposal-create-draft", audit.trace_id, result.value.proposalId])).rows[0].metadata;
    expect(Object.keys(visible)).toEqual(["resultSnapshot"]);
  });
  it("rejects actual other-database reader and stale current pin without creating a proposal", async () => {
    const before = (await admin.query("select count(*)::int as count from parameter_catalog.definition_proposals")).rows[0].count;
    const auditBefore = (await admin.query("select count(*)::int as count from public.audit_events")).rows[0].count;
    await expect(executeProposal(writer, command(), { readerPool: wrongReader })).rejects.toMatchObject({ name: "ProposalReadTargetError", reason: "read-target-mismatch" });
    expect((await admin.query("select count(*)::int as count from public.audit_events")).rows[0].count).toBe(auditBefore);
    const stale = { ...pin, digest: CatalogReleaseDigest(`sha256:${"0".repeat(64)}`) };
    expect(await executeProposal(writer, command({ baseRelease: stale, currentRelease: stale }), { readerPool: reader })).toMatchObject({ ok: false });
    expect((await admin.query("select count(*)::int as count from parameter_catalog.definition_proposals")).rows[0].count).toBe(before);
  });
  it("holds the scoped module row lock in the writer transaction without broad public SELECT", async () => {
    await expect(writer.query("select * from public.parameter_modules")).rejects.toMatchObject({ code: "42501" });
    const session = await writer.connect();
    const competitor = await admin.connect();
    try {
      await session.query("begin");
      expect(await lockDestinationModule(session, "role-org-2", "role-module")).toBeNull();
      expect(await lockDestinationModule(session, "role-org-1", "role-module")).toMatchObject({ id: "role-module", organization_id: "role-org-1" });
      await competitor.query("set lock_timeout='100ms'");
      await expect(competitor.query("update public.parameter_modules set name='blocked mutation' where id='role-module'")).rejects.toMatchObject({ code: "55P03" });
      await session.query("rollback");
      await competitor.query("update public.parameter_modules set name='after lock release' where id='role-module'");
    } finally {
      await session.query("rollback");
      await competitor.query("reset lock_timeout");
      session.release(); competitor.release();
    }
  });
  it("retains the shared current pointer lock across actual reader projection queries", async () => {
    const competitor = await admin.connect();
    try {
      await competitor.query("begin");
      await withProposalUnitOfWork(writer, async (session) => {
        expect(await lockAndLoadCurrentRelease(session)).toEqual({ ok: true, value: pin });
        expect((await competitor.query("select pg_try_advisory_xact_lock($1) as acquired", [CURRENT_POINTER_LOCK_KEY])).rows).toEqual([{ acquired: false }]);
        return { ok: true, value: null };
      }, reader);
      expect((await competitor.query("select pg_try_advisory_xact_lock($1) as acquired", [CURRENT_POINTER_LOCK_KEY])).rows).toEqual([{ acquired: true }]);
    } finally { await competitor.query("rollback"); competitor.release(); }
  });
  it("pins reader isolation despite a REPEATABLE READ login default", async () => {
    await admin.query("alter role scoped_reader in database postgres set default_transaction_isolation to 'repeatable read'");
    const configuredReader = new pg.Pool({ connectionString: url("scoped_reader") });
    let leasedReader: pg.PoolClient | undefined;
    configuredReader.on("acquire", (client) => { leasedReader = client; });
    try {
      expect((await configuredReader.query("show default_transaction_isolation")).rows).toEqual([{ default_transaction_isolation: "repeatable read" }]);
      await withProposalUnitOfWork(writer, async () => {
        expect((await leasedReader!.query("show transaction_isolation")).rows).toEqual([{ transaction_isolation: "read committed" }]);
        expect((await leasedReader!.query("show transaction_read_only")).rows).toEqual([{ transaction_read_only: "on" }]);
        return { ok: true, value: null };
      }, configuredReader);
    } finally {
      await configuredReader.end();
      await admin.query("alter role scoped_reader in database postgres reset default_transaction_isolation");
    }
  });
  it("registers through the real guarded writer with scoped destination lookup and rejects another organization", async () => {
    const input: RegisterSubjectCommand = {
      kind: "register", organizationId: "role-org-1", subjectId: CatalogSubjectId("csub_acme_power"),
      subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" },
      destinationModuleId: "role-driver-module", method: "explicit", proof: { reason: "isolated role regression" },
      idempotencyKey: randomBytes(12).toString("hex"), context: { actorKind: "org-admin", principalId: "isolated-author" },
    };
    expect(await executeRegistration(writer, input)).toMatchObject({ ok: true, value: { organizationId: "role-org-1", moduleId: "role-driver-module", registrationStatus: "active" } });
    expect(await executeRegistration(writer, { ...input, organizationId: "role-org-2", idempotencyKey: randomBytes(12).toString("hex") })).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    expect((await admin.query("select count(*)::int as count from parameter_catalog.organization_subject_registrations where organization_id='role-org-2'")).rows).toEqual([{ count: 0 }]);
  });
  it("fails closed when the installed database identity capability is unavailable", async () => {
    const before = (await admin.query("select count(*)::int as count from parameter_catalog.definition_proposals")).rows[0].count;
    await admin.query("revoke execute on function parameter_catalog.runtime_database_identity() from catalog_runtime_reader_role");
    try {
      await expect(executeProposal(writer, command(), { readerPool: reader })).rejects.toMatchObject({ name: "ProposalReadTargetError", reason: "read-target-unavailable" });
    } finally { await admin.query("grant execute on function parameter_catalog.runtime_database_identity() to catalog_runtime_reader_role"); }
    expect((await admin.query("select count(*)::int as count from parameter_catalog.definition_proposals")).rows[0].count).toBe(before);
  });
  it("refuses to adopt a pre-existing reader role with extra ACLs and preserves those ACLs", async () => {
    const migration = await readFile(path.resolve("server/migrations/0140_parameter_catalog_runtime_read_capability.sql"), "utf8");
    const session = await admin.connect();
    try {
      await session.query("grant insert on parameter_catalog.catalog_releases to catalog_runtime_reader_role");
      await session.query("begin");
      await expect(session.query(migration)).rejects.toMatchObject({ code: "55000", message: "PCAT_RUNTIME_READER_ACL_UNSAFE" });
      await session.query("rollback");
      expect((await session.query("select has_table_privilege('catalog_runtime_reader_role','parameter_catalog.catalog_releases','INSERT') as allowed")).rows).toEqual([{ allowed: true }]);
    } finally {
      await session.query("rollback");
      await session.query("revoke insert on parameter_catalog.catalog_releases from catalog_runtime_reader_role");
      session.release();
    }
  });
  it("rejects extra schema, function and ownership capabilities without silently repairing them", async () => {
    const migration = await readFile(path.resolve("server/migrations/0140_parameter_catalog_runtime_read_capability.sql"), "utf8");
    const cases = [
      { grant: "grant create on schema public to catalog_runtime_reader_role", revoke: "revoke create on schema public from catalog_runtime_reader_role",
        check: "select has_schema_privilege('catalog_runtime_reader_role','public','CREATE') as allowed" },
      { grant: "grant execute on function parameter_catalog.lock_governance_destination_module(text,text) to catalog_runtime_reader_role",
        revoke: "revoke execute on function parameter_catalog.lock_governance_destination_module(text,text) from catalog_runtime_reader_role",
        check: "select has_function_privilege('catalog_runtime_reader_role','parameter_catalog.lock_governance_destination_module(text,text)','EXECUTE') as allowed" },
      { grant: "create table public.owned_role_probe(id text); alter table public.owned_role_probe owner to catalog_runtime_reader_role",
        revoke: "drop table public.owned_role_probe",
        check: "select relowner='catalog_runtime_reader_role'::regrole as allowed from pg_class where oid='public.owned_role_probe'::regclass" },
    ];
    const session = await admin.connect();
    try {
      for (const probe of cases) {
        await session.query(probe.grant);
        try {
          await session.query("begin");
          await expect(session.query(migration)).rejects.toMatchObject({ code: "55000", message: "PCAT_RUNTIME_READER_ACL_UNSAFE" });
          await session.query("rollback");
          expect((await session.query(probe.check)).rows).toEqual([{ allowed: true }]);
        } finally { await session.query("rollback"); await session.query(probe.revoke); }
      }
    } finally { session.release(); }
  });
  it("retries management migrations through the unchanged ledger without re-adopting the role", async () => {
    const before = (await admin.query("select checksum from schema_migrations where name='0140_parameter_catalog_runtime_read_capability.sql'")).rows;
    expect(before).toHaveLength(1);
    const db = createPostgresDatabase(url("postgres"));
    try { await applyMigrations(db, path.resolve("server/migrations")); }
    finally { await db.close(); }
    expect((await admin.query("select checksum from schema_migrations where name='0140_parameter_catalog_runtime_read_capability.sql'")).rows).toEqual(before);
  });
});
