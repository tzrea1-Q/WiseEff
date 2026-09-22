import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { loadPublishedCatalog } from "../../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import {
  aggregateHotspotGroups
} from "./hotspotRepository";
import { aggregateTrend, countKpis } from "./repository";

const ORGANIZATION_ID = "org-dashboard-canonical-repository";
const PROJECT_ID = "project-dashboard-canonical-repository";
const USER_ID = "user-dashboard-canonical-repository";
const SUBJECT_ID = "csub_dashboard_repository";
const SCHEMA_ID = "wiseeff.dashboard.repository";
const DEFINITION_ID = "pdef_acme_power_iin_max";

describe("canonical dashboard repository", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  const auth = makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("dashboard_canonical_repository");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-dashboard-canonical-"));
    storage = createLocalObjectStore(storageDirectory);

    await db.query("insert into organizations(id,name) values ($1,'Canonical dashboard repository')", [ORGANIZATION_ID]);
    await db.query(
      "insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Dashboard user','Admin',true)",
      [USER_ID, ORGANIZATION_ID]
    );
    await db.query(
      "insert into projects(id,organization_id,name,code,status) values ($1,$2,'Canonical dashboard project','CDR','initialized')",
      [PROJECT_ID, ORGANIZATION_ID]
    );
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('dashboard-canonical-admin',$1,$2,null,'admin')`,
      [USER_ID, ORGANIZATION_ID]
    );

    await installConfigurationSourceFixture(db, auth, { subjectId: SUBJECT_ID, schemaId: SCHEMA_ID });
    const configSet = await createConfigSet(db, auth, { projectId: PROJECT_ID, name: "Canonical dashboard" });
    const uploaded = await uploadProjectParameterFile(db, storage, auth, {
      projectId: PROJECT_ID,
      fileName: "settings.json",
      bytes: Buffer.from('{"first":{"value":36.5},"second":{"value":42}}\n')
    });
    await addConfigSetFile(db, auth, {
      configSetId: configSet.id,
      fileId: uploaded.file.id,
      role: "base",
      sortOrder: 0
    });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published catalog fixture is unavailable");
    const refusalSink = createTrustedRefusalAuditSink(db);
    const invocation = createUserInvocation(auth);
    for (const [requestId, rootPointer, pointer] of [
      ["dashboard-canonical-first", "/first", "/first/value"],
      ["dashboard-canonical-second", "/second", "/second/value"]
    ] as const) {
      await db.transaction((tx) =>
        registerCanonicalJsonSource(tx, storage, auth, snapshot, {
          projectId: PROJECT_ID,
          configSetId: configSet.id,
          fileId: uploaded.file.id,
          fileVersionId: uploaded.version.id,
          configurationSchemaId: SCHEMA_ID,
          rootPointer,
          mappings: [{ definitionId: DEFINITION_ID, pointer }],
          invocation,
          requestId,
          refusalSink
        })
      );
    }
  }, 60_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("counts source-backed Bindings separately from distinct Definitions", async () => {
    const kpis = await countKpis(db, {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      authorizedProjectIds: [PROJECT_ID],
      windowStart: "2000-01-01T00:00:00.000Z",
      windowEnd: "2999-01-01T00:00:00.000Z"
    });

    expect(kpis.totalParameters).toBe(2);
    expect(kpis.totalBindings).toBe(2);
    expect(kpis.totalDefinitions).toBe(1);
    expect(kpis.highRiskParameters).toBeNull();
    expect(kpis.riskAvailability).toBe("unavailable");
  });

  it("uses canonical Binding identity for every hotspot dimension and ignores the legacy store", async () => {
    const baseInput = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      authorizedProjectIds: [PROJECT_ID],
      windowStart: "2000-01-01T00:00:00.000Z",
      windowEnd: "2999-01-01T00:00:00.000Z"
    } as const;

    const projectGroups = await aggregateHotspotGroups(db, { ...baseInput, dimension: "project" });
    expect(projectGroups).toHaveLength(1);
    expect(projectGroups[0]?.parameterCount).toBe(2);
    expect(projectGroups[0]?.definitionCount).toBe(1);

    const moduleGroups = await aggregateHotspotGroups(db, { ...baseInput, dimension: "module" });
    expect(moduleGroups).toHaveLength(1);
    expect(moduleGroups[0]?.parameterCount).toBe(2);
    expect(moduleGroups[0]?.definitionCount).toBe(1);

    const parameterGroups = await aggregateHotspotGroups(db, { ...baseInput, dimension: "parameter" });
    expect(parameterGroups).toHaveLength(2);
    expect(new Set(parameterGroups.map((group) => group.groupId)).size).toBe(2);
    expect(parameterGroups.every((group) => group.parameterCount === 1 && group.definitionCount === 1)).toBe(true);
    expect(parameterGroups.every((group) => group.groupId.length > 0)).toBe(true);
  });

  it("uses the history window as [start, end) for real canonical events", async () => {
    const history = await db.query<{ event_at: string; before_at: string; after_at: string }>(
      `select history.created_at::text as event_at,
              (history.created_at - interval '1 microsecond')::text as before_at,
              (history.created_at + interval '1 microsecond')::text as after_at
         from parameter_catalog.binding_history_events history
         join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
        where binding.organization_id = $1 and binding.project_id = $2
        order by history.created_at asc, history.id asc
        limit 1`,
      [ORGANIZATION_ID, PROJECT_ID]
    );
    const event = history.rows[0];
    expect(event).toBeDefined();
    const input = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      authorizedProjectIds: [PROJECT_ID],
      windowStart: event.event_at,
      windowEnd: event.after_at
    } as const;

    const kpis = await countKpis(db, input);
    const trend = await aggregateTrend(db, { ...input, granularity: "day" });
    expect(kpis.changeFrequency).toBeGreaterThan(0);
    expect(trend.reduce((total, point) => total + point.changeCount, 0)).toBe(kpis.changeFrequency);

    const eventAtEnd = await countKpis(db, {
      ...input,
      windowStart: event.before_at,
      windowEnd: event.event_at
    });
    expect(eventAtEnd.changeFrequency).toBe(0);
  });
});
