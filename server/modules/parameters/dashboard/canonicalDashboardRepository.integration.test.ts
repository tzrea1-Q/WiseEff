import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { loadPublishedCatalog } from "../../parameter-bindings/catalogProjectValueSync";
import { readProjectValueHistory } from "../../parameter-bindings/values/service";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { ParameterDefinitionId } from "../../parameter-catalog-contract";
import { createCanonicalValueDraft } from "../../parameter-bindings/drafts/service";
import { loadCanonicalBindingPins } from "../../parameter-bindings/drafts/repository";
import {
  reviewCanonicalValueChange,
  submitCanonicalValueChange
} from "../../parameter-bindings/drafts/changeService";
import {
  aggregateHotspotGroups
} from "./hotspotRepository";
import { aggregatePersonalTrend, aggregateRiskDistribution, aggregateTrend, aggregateWorkbenchSignals, countKpis } from "./repository";

const ORGANIZATION_ID = "org-dashboard-canonical-repository";
const PROJECT_ID = "project-dashboard-canonical-repository";
const USER_ID = "user-dashboard-canonical-repository";
const SUBJECT_ID = "csub_dashboard_repository";
const SCHEMA_ID = "wiseeff.dashboard.repository";
const DEFINITION_ID = "pdef_acme_power_iin_max";
const REVIEWER_ID = "user-dashboard-canonical-reviewer";

describe("canonical dashboard repository", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let canonicalBindings: Awaited<ReturnType<typeof registerCanonicalJsonSource>>["bindings"] = [];
  let expectedTitle = "";
  let expectedRevisionId = "";
  const auth = makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });
  const reviewerAuth = makeTestAuthContext({
    userId: REVIEWER_ID,
    organizationId: ORGANIZATION_ID,
    roles: [{ projectId: PROJECT_ID, roleId: "software-committer" }]
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
      "insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Dashboard reviewer','Committer',true)",
      [REVIEWER_ID, ORGANIZATION_ID]
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
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('dashboard-canonical-committer',$1,$2,$3,'software-committer')`,
      [REVIEWER_ID, ORGANIZATION_ID, PROJECT_ID]
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
    const definition = snapshot.getDefinitionById(ParameterDefinitionId(DEFINITION_ID));
    if (definition.status !== "found") throw new Error("Published dashboard Definition fixture is unavailable");
    expectedTitle = definition.definition.selectedRevision.content.displayName ?? definition.definition.propertyKey;
    expectedRevisionId = definition.definition.selectedRevision.id;
    const refusalSink = createTrustedRefusalAuditSink(db);
    const invocation = createUserInvocation(auth);
    for (const [requestId, rootPointer, pointer] of [
      ["dashboard-canonical-first", "/first", "/first/value"],
      ["dashboard-canonical-second", "/second", "/second/value"]
    ] as const) {
      const registration = await db.transaction((tx) =>
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
      canonicalBindings.push(...registration.bindings);
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
    expect(projectGroups[0]?.modifiedParamCount).toBe(0);

    const moduleGroups = await aggregateHotspotGroups(db, { ...baseInput, dimension: "module" });
    expect(moduleGroups).toHaveLength(1);
    expect(moduleGroups[0]?.parameterCount).toBe(2);
    expect(moduleGroups[0]?.definitionCount).toBe(1);

    const parameterGroups = await aggregateHotspotGroups(db, { ...baseInput, dimension: "parameter" });
    expect(parameterGroups).toHaveLength(2);
    expect(new Set(parameterGroups.map((group) => group.groupId)).size).toBe(2);
    expect(parameterGroups.every((group) => group.parameterCount === 1 && group.definitionCount === 1)).toBe(true);
    expect(parameterGroups.every((group) => group.groupId.length > 0)).toBe(true);
    expect(parameterGroups.map((group) => group.title)).toEqual([expectedTitle, expectedTitle]);
    expect(canonicalBindings).toHaveLength(2);
    expect(canonicalBindings.every((binding) => binding.effectiveRevisionId === expectedRevisionId)).toBe(true);
  });

  it("uses the history window as [start, end) for real canonical events", async () => {
    const binding = canonicalBindings[0];
    expect(binding).toBeDefined();
    const history = await readProjectValueHistory(getRootPostgresPool(db)!, {
      binding,
      definitionRevisionId: binding.effectiveRevisionId
    });
    expect(history.ok).toBe(true);
    if (!history.ok) throw new Error("Canonical value history is unavailable");
    const currentValue = history.value.find((value) => value.id === binding.currentValueId);
    expect(currentValue).toBeDefined();
    if (!currentValue) throw new Error("Canonical current value is unavailable");
    // Both the value append and its Binding history event use the same transaction timestamp.
    const eventAt = new Date(currentValue.createdAt);
    const input = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      authorizedProjectIds: [PROJECT_ID],
      windowStart: eventAt.toISOString(),
      windowEnd: new Date(eventAt.getTime() + 1_000).toISOString()
    } as const;

    const kpis = await countKpis(db, input);
    const trend = await aggregateTrend(db, { ...input, granularity: "day" });
    expect(kpis.changeFrequency).toBeGreaterThan(0);
    expect(trend.reduce((total, point) => total + point.changeCount, 0)).toBe(kpis.changeFrequency);

    const eventAtEnd = await countKpis(db, {
      ...input,
      windowStart: new Date(eventAt.getTime() - 1_000).toISOString(),
      windowEnd: eventAt.toISOString()
    });
    expect(eventAtEnd.changeFrequency).toBe(0);
  });

  it("keeps dashboard trend buckets on UTC day boundaries in a non-UTC session", async () => {
    const binding = canonicalBindings[0];
    expect(binding).toBeDefined();
    const history = await readProjectValueHistory(getRootPostgresPool(db)!, {
      binding,
      definitionRevisionId: binding.effectiveRevisionId
    });
    expect(history.ok).toBe(true);
    if (!history.ok) throw new Error("Canonical value history is unavailable");
    const currentValue = history.value.find((value) => value.id === binding.currentValueId);
    expect(currentValue).toBeDefined();
    if (!currentValue) throw new Error("Canonical current value is unavailable");
    const windowStart = new Date(currentValue.createdAt);
    windowStart.setUTCHours(0, 0, 0, 0);
    const input = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      authorizedProjectIds: [PROJECT_ID],
      windowStart: windowStart.toISOString(),
      windowEnd: new Date(windowStart.getTime() + 86_400_000).toISOString()
    } as const;

    await db.transaction(async (tx) => {
      await tx.query("set local time zone 'Pacific/Honolulu'");
      const trends = [
        await aggregateTrend(tx, { ...input, granularity: "day" }),
        ...await Promise.all(["user", "committer", "admin"].map((roleLevel) => aggregatePersonalTrend(tx, {
          ...input,
          userId: USER_ID,
          granularity: "day",
          roleLevel: roleLevel as "user" | "committer" | "admin"
        })))
      ];

      for (const trend of trends) {
        expect(trend.map((point) => point.bucketStart)).toEqual([input.windowStart]);
      }
    });
  });

  it("excludes identity bootstrap from modified scope but counts a later committed change", async () => {
    const binding = canonicalBindings[0];
    expect(binding).toBeDefined();
    const input = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      authorizedProjectIds: [PROJECT_ID],
      windowStart: "2000-01-01T00:00:00.000Z",
      windowEnd: "2999-01-01T00:00:00.000Z",
      dimension: "project" as const
    };
    const initial = await aggregateHotspotGroups(db, input);
    expect(initial[0]?.modifiedParamCount).toBe(0);

    const pins = await loadCanonicalBindingPins(db, {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      bindingId: binding.id
    });
    expect(pins).not.toBeNull();
    if (!pins) throw new Error("Canonical dashboard Binding pins are unavailable");
    const draft = await createCanonicalValueDraft(db, auth, {
      projectId: PROJECT_ID,
      bindingId: binding.id,
      sourceTarget: { format: "json", sourceText: '{"first":{"value":37.5},"second":{"value":42}}' },
      reason: "Count a later committed canonical value change",
      baseRevisionId: pins.configRevisionId,
      baseCurrentValueId: pins.currentValueId
    }, {
      objectStore: storage,
      invocation: createUserInvocation(auth),
      requestId: "dashboard-canonical-change-draft",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    const request = await submitCanonicalValueChange(db, auth, {
      projectId: PROJECT_ID,
      draftId: draft.id,
      invocation: createUserInvocation(auth),
      requestId: "dashboard-canonical-change-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published dashboard Definition fixture is unavailable");
    await reviewCanonicalValueChange(db, reviewerAuth, {
      projectId: PROJECT_ID,
      requestId: request.id,
      decision: "approve"
    }, {
      objectStore: storage,
      snapshot,
      invocation: createUserInvocation(reviewerAuth),
      traceId: "dashboard-canonical-change-review",
      refusalSink: createTrustedRefusalAuditSink(db)
    });

    const changed = await aggregateHotspotGroups(db, input);
    // One reviewed JSON file revision moves both source-backed Binding tips to
    // the new exact file-version pin, so both are modified scope members.
    expect(changed[0]?.modifiedParamCount).toBe(2);
  });

  it("isolates non-zero canonical inventory, history and workflow across projects and organizations", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published catalog fixture is unavailable");
    const projects = [
      { organizationId: "org-dashboard-isolation-a", projectId: "project-dashboard-isolation-a1" },
      { organizationId: "org-dashboard-isolation-a", projectId: "project-dashboard-isolation-a2" },
      { organizationId: "org-dashboard-isolation-b", projectId: "project-dashboard-isolation-b1" }
    ];
    const historyCounts = new Map<string, number>();
    const bindingIds = new Map<string, string[]>();
    const moduleIds = new Map<string, string>();
    for (const organizationId of new Set(projects.map((project) => project.organizationId))) {
      const context = makeTestAuthContext({ organizationId, userId: `${organizationId}-author` });
      await db.query("insert into organizations(id,name) values ($1,$1)", [organizationId]);
      for (const userId of [context.user.id, `${organizationId}-reviewer`]) {
        await db.query(
          "insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'Admin',true)",
          [userId, organizationId]
        );
      }
      const module = await installConfigurationSourceFixture(db, context, { subjectId: SUBJECT_ID, schemaId: SCHEMA_ID });
      moduleIds.set(organizationId, module.id);
    }
    for (const { organizationId, projectId } of projects) {
      const context = makeTestAuthContext({ organizationId, userId: `${organizationId}-author` });
      await db.query(
        "insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",
        [projectId, organizationId]
      );
      await db.query(
        `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
         values ($1,$2,$3,$4,'software-committer')`,
        [`${projectId}-committer`, `${organizationId}-reviewer`, organizationId, projectId]
      );
      const configSet = await createConfigSet(db, context, { projectId, name: "Isolation" });
      const uploaded = await uploadProjectParameterFile(db, storage, context, {
        projectId, fileName: "settings.json", bytes: Buffer.from('{"first":{"value":36.5},"second":{"value":42}}\n')
      });
      await addConfigSetFile(db, context, {
        configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0
      });
      const bindings: typeof canonicalBindings = [];
      for (const property of ["first", "second"]) {
        const registration = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, context, snapshot, {
          projectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
          configurationSchemaId: SCHEMA_ID, rootPointer: `/${property}`,
          mappings: [{ definitionId: DEFINITION_ID, pointer: `/${property}/value` }],
          invocation: createUserInvocation(context), requestId: `${projectId}-${property}-register`,
          refusalSink: createTrustedRefusalAuditSink(db)
        }));
        bindings.push(...registration.bindings);
      }
      expect(bindings).toHaveLength(2);
      bindingIds.set(projectId, bindings.map((binding) => binding.id));
      for (const [index, binding] of bindings.entries()) {
        const pins = await loadCanonicalBindingPins(db, { organizationId, projectId, bindingId: binding.id });
        if (!pins) throw new Error("Isolation Binding pins are unavailable");
        const draft = await createCanonicalValueDraft(db, context, {
          projectId, bindingId: binding.id,
          sourceTarget: { format: "json", sourceText: index === 0 ? "37.5" : "43" },
          reason: "Dashboard isolation", baseRevisionId: pins.configRevisionId, baseCurrentValueId: pins.currentValueId
        }, {
          objectStore: storage, invocation: createUserInvocation(context),
          requestId: `${projectId}-${index}-draft`, refusalSink: createTrustedRefusalAuditSink(db)
        });
        if (index === 0) {
          const request = await submitCanonicalValueChange(db, context, {
            projectId, draftId: draft.id, invocation: createUserInvocation(context),
            requestId: `${projectId}-submit`, refusalSink: createTrustedRefusalAuditSink(db)
          });
          expect(request.status).toBe("pending");
        }
      }
      let historyCount = 0;
      for (const binding of bindings) {
        const history = await readProjectValueHistory(getRootPostgresPool(db)!, {
          binding, definitionRevisionId: binding.effectiveRevisionId
        });
        expect(history.ok).toBe(true);
        if (!history.ok) throw new Error("Isolation value history is unavailable");
        const sourceHistory = history.value.filter((value) => value.source.sourceRef !== "canonical-binding-identity");
        expect(sourceHistory).toHaveLength(1);
        historyCount += sourceHistory.length;
      }
      historyCounts.set(projectId, historyCount);
    }

    const [first, second, foreign] = projects;
    for (const scope of [
      { organizationId: first.organizationId, projectId: first.projectId, authorizedProjectIds: null, visible: [first] },
      { organizationId: first.organizationId, projectId: second.projectId, authorizedProjectIds: null, visible: [second] },
      { organizationId: foreign.organizationId, projectId: foreign.projectId, authorizedProjectIds: null, visible: [foreign] },
      { organizationId: first.organizationId, projectId: null, authorizedProjectIds: null, visible: [first, second] },
      { organizationId: first.organizationId, projectId: null, authorizedProjectIds: [first.projectId], visible: [first] },
      { organizationId: first.organizationId, projectId: null, authorizedProjectIds: [first.projectId, foreign.projectId], visible: [first] },
      { organizationId: foreign.organizationId, projectId: null, authorizedProjectIds: null, visible: [foreign] },
      { organizationId: first.organizationId, projectId: foreign.projectId, authorizedProjectIds: null, visible: [] },
      { organizationId: first.organizationId, projectId: second.projectId, authorizedProjectIds: [first.projectId], visible: [] },
      { organizationId: first.organizationId, projectId: null, authorizedProjectIds: [], visible: [] }
    ]) {
      const input = { ...scope, windowStart: "2000-01-01T00:00:00.000Z", windowEnd: "2999-01-01T00:00:00.000Z" };
      const visibleIds = scope.visible.map((project) => project.projectId);
      const expectedHistory = visibleIds.reduce((count, projectId) => count + historyCounts.get(projectId)!, 0);
      expect(await countKpis(db, input)).toMatchObject({
        totalParameters: visibleIds.length * 2, totalBindings: visibleIds.length * 2,
        totalDefinitions: visibleIds.length ? 1 : 0, managedProjects: visibleIds.length,
        changeFrequency: expectedHistory, activeContributors: 0,
        highRiskParameters: null, riskAvailability: "unavailable"
      });
      const signals = await aggregateWorkbenchSignals(db, {
        ...input, userId: `${scope.organizationId}-author`, reviewableProjectIds: projects.map((project) => project.projectId)
      });
      expect(signals.myDrafts).toBe(visibleIds.length);
      const reviewerSignals = await aggregateWorkbenchSignals(db, {
        ...input, userId: `${scope.organizationId}-reviewer`, reviewableProjectIds: projects.map((project) => project.projectId)
      });
      expect(reviewerSignals.reviewQueue).toBe(visibleIds.length);
      const risk = await aggregateRiskDistribution(db, input);
      expect(risk.map((bucket) => bucket.projectId).sort()).toEqual([...visibleIds].sort());
      expect(risk.every((bucket) => bucket.high === null && bucket.riskAvailability === "unavailable")).toBe(true);
      for (const dimension of ["project", "module", "parameter"] as const) {
        const groups = await aggregateHotspotGroups(db, { ...input, dimension });
        expect(groups.reduce((count, group) => count + group.parameterCount, 0)).toBe(visibleIds.length * 2);
        expect(groups.reduce((count, group) => count + group.historyEventsInWindow, 0)).toBe(expectedHistory);
        expect(groups.reduce((count, group) => count + group.openRequestCount, 0)).toBe(visibleIds.length);
        expect(groups.reduce((count, group) => count + group.relatedRequestCount, 0)).toBe(visibleIds.length);
        if (dimension === "project") {
          expect(groups.map((group) => group.projectId).sort()).toEqual([...visibleIds].sort());
        } else if (dimension === "parameter") {
          expect(groups.map((group) => group.groupId).sort()).toEqual(visibleIds.flatMap((projectId) => bindingIds.get(projectId)!).sort());
        } else {
          expect(groups.map((group) => group.groupId)).toEqual(visibleIds.length ? [moduleIds.get(scope.organizationId)] : []);
        }
      }
    }
  }, 120_000);
});
