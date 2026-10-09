import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { applyTestMigrations, migrationsDir } from "../../testing/tempDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { seedHistoricalSingletonMapping } from "../../testing/parameterCatalog/driverSource";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createLocalObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import type { ReleaseReadinessResult } from "./releaseReadinessService";

const organizationId = "org-1061";
const projectId = "project-1061";
const adminId = "admin-1061";
const authorId = "author-1061";
const reviewerId = "reviewer-1061";
const admin = makeTestAuthContext({ userId: adminId, organizationId });

describe("#1061 assembled-server canonical release readiness", () => {
  let db: RootDatabase;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string;
  let databaseName: string;
  let server: ReturnType<typeof createWiseEffServer>;
  let adminPool: pg.Pool;
  let baseUrl: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Canonical readiness requires explicit real PostgreSQL.");
    const connection = new URL(databaseUrl);
    connection.pathname = "/postgres";
    adminPool = new pg.Pool({ connectionString: connection.toString() });
    databaseName = `t1061_readiness_${randomUUID().replaceAll("-", "")}`;
    await adminPool.query(`create database ${databaseName}`);
    connection.pathname = `/${databaseName}`;
    db = createPostgresDatabase(connection.toString());
    await applyTestMigrations(db, migrationsDir);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-t1061-readiness-"));
    storage = createLocalObjectStore(directory);
    await seedCoreGraph(db, {
      organization: { id: organizationId },
      users: [{ id: adminId }, { id: authorId }, { id: reviewerId }],
      projects: [{ id: projectId }]
    });
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('admin-role-1061',$1,$2,null,'admin'),
      ('author-role-1061',$3,$2,$5,'software-user'),
      ('reviewer-role-1061',$4,$2,$5,'software-committer')`,
    [adminId, organizationId, authorId, reviewerId, projectId]);
    await installConfigurationSourceFixture(db, admin, {
      subjectId: "csub_acme_power", schemaId: "wiseeff.1061.readiness"
    });
    server = createWiseEffServer({ db, objectStore: storage });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Assembled test server did not bind to loopback.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db?.close();
    if (databaseName) await adminPool.query(`drop database ${databaseName}`);
    await adminPool?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function request(path: string, userId = adminId, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-WiseEff-User": userId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }

  async function source(name: string, sourceProjectId = projectId, singletonProbe = false) {
    const set = await createConfigSet(db, admin, { projectId: sourceProjectId, name });
    const dtsContent = `/dts-v1/;\n/ { compatible = "wiseeff,readiness"; model = "Readiness"; #address-cells = <1>; #size-cells = <1>;
      ${singletonProbe ? 'first { compatible = "legacy,singleton"; }; second { compatible = "legacy,singleton"; };' : ""}
    };\n`;
    const dts = await uploadProjectParameterFile(db, storage, admin, {
      projectId: sourceProjectId, fileName: `${name}.dts`, bytes: Buffer.from(dtsContent)
    });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: dts.file.id, role: "base", sortOrder: 0 });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: sourceProjectId, fileName: `${name}.json`, bytes: Buffer.from('{"limit":36}\n')
    });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "misc", sortOrder: 1 });
    const revision = await ingestConfigRevision(db, {
      organizationId, projectId: sourceProjectId, configSetId: set.id, entryFile: `${name}.dts`, includeSearchPaths: ["."], overlayOrder: [],
      members: [
        { fileId: dts.file.id, fileVersionId: dts.version.id, fileName: `${name}.dts`, sourceName: `${name}.dts`, role: "base", sortOrder: 0, content: dtsContent },
        { fileId: uploaded.file.id, fileVersionId: uploaded.version.id, fileName: `${name}.json`, sourceName: `${name}.json`, format: "json", role: "misc", sortOrder: 1, content: '{"limit":36}\n' }
      ]
    }, admin, { legacyProjection: "skip" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog unavailable.");
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
      projectId: sourceProjectId, configSetId: set.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
      configurationSchemaId: "wiseeff.1061.readiness", rootPointer: "",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
      invocation: createUserInvocation(admin), requestId: `register-${name}`, refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const binding = registered.bindings[0]!;
    return { configSetId: set.id, bindingId: binding.id, revisionId: revision.id, projectId: sourceProjectId };
  }

  async function readiness(source: { configSetId: string; projectId: string }): Promise<ReleaseReadinessResult> {
    const result = await request(`/api/v1/projects/${source.projectId}/config-sets/${source.configSetId}/release-readiness`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.item.available).toBe(true);
    return result.body.item;
  }

  async function submit(selected: Awaited<ReturnType<typeof source>>) {
    const draft = await request(`/api/v2/projects/${selected.projectId}/parameter-bindings/${selected.bindingId}/drafts`, authorId, {
      baseRevisionId: selected.revisionId, sourceTarget: { format: "json", sourceText: "50" }, reason: "#1061 pending review"
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const submitted = await request(`/api/v2/projects/${selected.projectId}/parameter-value-drafts/${draft.body.item.draftId}/submit`, authorId, {
      assignedToUserId: reviewerId
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    expect(submitted.body.item.status).toBe("pending");
    return submitted.body.item.id as string;
  }

  it.each(["approve", "reject", "withdraw"] as const)("blocks canonical pending submission and clears after %s without a legacy mirror", async (decision) => {
    const selected = await source(decision);
    const initial = await readiness(selected);
    expect(initial.canRelease, JSON.stringify(initial)).toBe(true);
    const requestId = await submit(selected);
    const pending = await readiness(selected);
    expect(pending.canRelease).toBe(false);
    expect(pending.canCreateBaseline).toBe(false);
    expect(pending.blockers).toContainEqual(expect.objectContaining({ code: "pending-change", message: expect.stringContaining("1") }));
    const reviewed = await request(`/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}/${decision === "withdraw" ? "withdraw" : "review"}`,
      decision === "withdraw" ? authorId : reviewerId, decision === "withdraw" ? {} : { decision });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.body.item.status).toBe({ approve: "approved", reject: "rejected", withdraw: "withdrawn" }[decision]);
    const cleared = await readiness(selected);
    expect(cleared.blockers.filter((item) => item.code === "pending-change")).toEqual([]);
    expect(cleared.canRelease).toBe(true);
    const legacy = await db.query<{ count: number }>("select count(*)::int as count from parameter_change_requests where project_id=$1", [projectId]);
    expect(legacy.rows[0]!.count).toBe(0);
  });

  it.each(["create", "release"] as const)("refuses stale %s confirmation when canonical pending work appears", async (action) => {
    const selected = await source(`stale-${action}`);
    const initial = await readiness(selected);
    expect(initial.canRelease, JSON.stringify(initial)).toBe(true);
    const baseline = await request(`/api/v1/projects/${projectId}/config-sets/${selected.configSetId}/baselines`, adminId, {
      name: `baseline-${action}`, gateToken: initial.gateToken
    });
    expect(baseline.status, JSON.stringify(baseline.body)).toBe(201);
    const confirmed = await readiness(selected);
    await submit(selected);
    const path = action === "create"
      ? `/api/v1/projects/${projectId}/config-sets/${selected.configSetId}/baselines`
      : `/api/v1/projects/${projectId}/baselines/${baseline.body.item.id}/release`;
    const result = await request(path, adminId, { gateToken: confirmed.gateToken, ...(action === "create" ? { name: "must-not-create" } : {}) });
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body.error.details.code).toBe("readiness-gate-stale");
    const saved = await db.query<{ status: string; count: number }>(
      `select status,(select count(*)::int from dts_release_baseline where config_set_id=$2) as count
       from dts_release_baseline where id=$1`, [baseline.body.item.id, selected.configSetId]);
    expect(saved.rows[0]).toEqual({ status: "draft", count: 1 });
  });

  it("scopes pending source requests to their exact config set and project", async () => {
    const selected = await source("scoped");
    const initial = await readiness(selected);
    const other = await source("other-config");
    await submit(other);
    await db.query("insert into projects(id,organization_id,name,code,status) values ('other-project-1061',$1,'Other','OTHER1061','initialized')", [organizationId]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('author-other-1061',$1,$2,'other-project-1061','software-user'),
      ('reviewer-other-1061',$3,$2,'other-project-1061','software-committer')`, [authorId, organizationId, reviewerId]);
    const otherProject = await source("other-project", "other-project-1061");
    await submit(otherProject);
    const unaffected = await readiness(selected);
    expect(unaffected.canRelease, JSON.stringify(unaffected)).toBe(true);
    expect(unaffected.gateToken).toBe(initial.gateToken);
    expect(unaffected.blockers.filter((item) => item.code === "pending-change")).toEqual([]);
    await submit(selected);
    const pending = await readiness(selected);
    expect(pending.canRelease).toBe(false);
    expect(pending.blockers).toContainEqual(expect.objectContaining({ code: "pending-change", message: expect.stringMatching(/^1 server-visible/) }));
  });

  it("evaluates readiness without creating or updating legacy identity-mapping tasks", async () => {
    const selected = await source("singleton-probe", projectId, true);
    await seedHistoricalSingletonMapping(db, { organizationId, moduleId: "pmod-singleton-1061", compatible: "legacy,singleton" });
    const tasks = () => db.query("select * from identity_mapping_tasks where organization_id=$1 order by id", [organizationId]);
    const before = await tasks();
    await readiness(selected);
    expect((await tasks()).rows).toEqual(before.rows);
    await readiness(selected);
    expect((await tasks()).rows).toEqual(before.rows);
  });
});
