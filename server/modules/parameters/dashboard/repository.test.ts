import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../../testing/testDatabase";
import {
  PARAMETER_DASHBOARD_FIXTURE,
  seedParameterDashboardFixture
} from "../../../testing/parameterDashboardFixture";
import type { Database } from "../../../shared/database/client";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { getAuthContext } from "../../auth/repository";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { createCandidate } from "../../parameter-files/candidateService";
import { previewCanonicalCandidate, freezeCanonicalCandidateBatchSnapshotInTransaction } from "../../parameter-files/canonicalFileWorkflow";
import { loadPublishedCatalog } from "../../parameter-bindings/catalogProjectValueSync";
import { submitCanonicalMemberRemoval, listCanonicalMemberRemovalsForAuth, reviewCanonicalMemberRemoval } from "../../parameter-bindings/drafts/memberRemovalChangeService";
import { submitCanonicalBatchValueChange, listCanonicalBatchValueChangesForAuth } from "../../parameter-bindings/drafts/batchChangeService";
import { createCanonicalValueDraft } from "../../parameter-bindings/drafts/service";
import { submitCanonicalValueChange, listCanonicalValueChangesForAuth, withdrawCanonicalValueChange } from "../../parameter-bindings/drafts/changeService";
import { createParameterModuleForAuth } from "../service";
import { executeRegistration } from "../../parameter-governance/registration";
import { CatalogSubjectId } from "../../parameter-catalog-contract";
import {
  countKpis,
  aggregateTrend,
  aggregateRiskDistribution,
  aggregateWorkbenchSignals,
  countPersonalKpis,
  aggregatePersonalTrend
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("canonical dashboard assigned review queue", () => {
  it("counts assigned member/batch requests once while preserving broad single visibility and scope", async () => {
    const lane = await createEphemeralTestDatabase("dashboard-assigned-counter");
    const db = createPostgresDatabase(lane.url);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-dashboard-counter-"));
    const storage = createLocalObjectStore(directory);
    const organizationId = "org-dashboard-counter", projectId = "project-dashboard-counter";
    const schemaId = "wiseeff.dashboard.counter", definitionId = "pdef_acme_power_iin_max";
    const aId = "counter-reviewer-a", bId = "counter-reviewer-b", cId = "counter-submitter-c";
    try {
      await db.query("insert into organizations(id,name) values($1,'Dashboard counter')", [organizationId]);
      await db.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'Counter','COUNTER','initialized')", [projectId, organizationId]);
      for (const userId of [aId, bId, cId]) {
        await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$1,'Counter',true)", [userId, organizationId]);
      }
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
        ('counter-admin-c',$1,$4,null,'admin'),('counter-admin-a',$2,$4,null,'admin'),
        ('counter-review-a',$2,$4,$5,'software-committer'),('counter-view-a',$2,$4,$5,'software-user'),
        ('counter-review-b',$3,$4,$5,'software-committer'),('counter-view-b',$3,$4,$5,'software-user')`,
      [cId, aId, bId, organizationId, projectId]);
      const [a, b, c] = await Promise.all([aId, bId, cId].map((id) => getAuthContext(db, id)));
      const context = (actor = c) => ({ invocation: createUserInvocation(actor), requestId: randomUUID(), refusalSink: createTrustedRefusalAuditSink(db) });
      const removalContext = (actor = c) => { const ctx = context(actor); return { invocation: ctx.invocation, traceId: ctx.requestId, refusalSink: ctx.refusalSink }; };
      await installConfigurationSourceFixture(db, c, { subjectId: "csub_dashboard_counter", schemaId });
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
      // Each producer owns a separate source cohort so no sibling pending conflict is bypassed.
      const source = async (kind: "removal" | "batch" | "single", actor = c, sourceProjectId = projectId) => {
        const projectId = sourceProjectId;
        const configSet = await createConfigSet(db, actor, { projectId, name: "Counter " + randomUUID() });
        const files = [];
        const bindings = [];
        for (let index = 0; index < (kind === "removal" ? 2 : 1); index++) {
          const uploaded = await uploadProjectParameterFile(db, storage, actor, { projectId,
            fileName: randomUUID() + ".json", bytes: Buffer.from(kind === "batch"
              ? '{"settings":{"limit":36.5},"other":{"limit":48}}\n' : '{"limit":36.5}\n') });
          files.push(uploaded);
          await addConfigSetFile(db, actor, { configSetId: configSet.id, fileId: uploaded.file.id, role: index === 0 ? "base" : "overlay", sortOrder: index });
        }
        for (const file of files) {
          for (const mapping of kind === "batch" ? [{ rootPointer: "", pointer: "/settings/limit" }, { rootPointer: "/other", pointer: "/other/limit" }] : [{ rootPointer: "", pointer: "/limit" }]) {
            const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, actor, snapshot, {
              projectId, configSetId: configSet.id, fileId: file.file.id, fileVersionId: file.version.id, configurationSchemaId: schemaId,
              rootPointer: mapping.rootPointer, mappings: [{ definitionId, pointer: mapping.pointer }], ...context(actor)
            }));
            bindings.push(registered.bindings[0]!);
          }
        }
        const revision = (await db.query<{ id: string }>("select config_revision_id as id from parameter_catalog.project_value_source_pins where project_value_id=$1", [bindings[0]!.currentValueId])).rows[0]!.id;
        return { configSet, files, bindings, revision };
      };
      const removal = async (assignedToUserId: string) => {
        const f = await source("removal");
        const result = await submitCanonicalMemberRemoval(db, storage, c, { projectId, configSetId: f.configSet.id,
          fileId: f.files[0]!.file.id, reason: "Counter removal", assignedToUserId, ...removalContext() });
        expect(result.status).toBe("pending");
        return result;
      };
      const batch = async (assignedToUserId: string) => {
        const f = await source("batch"), file = f.files[0]!;
        const candidate = await createCandidate(db, storage, c, { projectId, fileId: file.file.id, fileName: file.file.fileName,
          bytes: Buffer.from('{"settings":{"limit":50},"other":{"limit":60}}\n') });
        const preview = await previewCanonicalCandidate(db, storage, c, { projectId, candidateId: candidate.id });
        expect(preview).toMatchObject({ canSubmit: false, reason: "canonical-batch-writer-unavailable" });
        const frozen = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, c,
          { projectId, candidateId: candidate.id, expectedProofToken: preview.proofToken! }));
        const result = await submitCanonicalBatchValueChange(db, storage, c, { projectId, candidateId: candidate.id,
          expectedProofToken: frozen.proofToken, assignedToUserId, reason: "Counter batch",
          targetDecisions: f.bindings.map((binding) => ({ bindingId: binding.id, choice: "file" as const })), ...context() });
        expect(result.status).toBe("pending");
        expect(result.targets).toHaveLength(2);
        expect(new Set(result.targets.map((target) => target.bindingId))).toEqual(new Set(f.bindings.map((binding) => binding.id)));
        return result;
      };
      const single = async (assignedToUserId: string | null, actor = c, sourceProjectId = projectId) => {
        const projectId = sourceProjectId;
        const f = await source("single", actor, projectId), binding = f.bindings[0]!;
        const draft = await createCanonicalValueDraft(db, actor, { projectId, bindingId: binding.id,
          sourceTarget: { format: "json", sourceText: "50" }, reason: "Counter single", baseRevisionId: f.revision,
          baseCurrentValueId: binding.currentValueId }, { objectStore: storage, ...context(actor) });
        const result = await submitCanonicalValueChange(db, actor, { projectId, draftId: draft.id, assignedToUserId, ...context(actor) });
        expect(result.status).toBe("pending");
        return result;
      };
      const removals = [await removal(aId), await removal(bId)];
      const batches = [await batch(aId), await batch(bId)];
      const singles = [await single(bId), await single(null)];
      const scope = { organizationId, projectId, authorizedProjectIds: [projectId], reviewableProjectIds: [projectId] };
      const queue = (userId: string, overrides = {}) => aggregateWorkbenchSignals(db, { ...scope, userId, ...overrides });
      const census = async (actor: typeof a) => {
        const index = actor.user.id === aId ? 0 : 1;
        const visibleRemovals = await listCanonicalMemberRemovalsForAuth(db, actor, { projectId, status: "pending" });
        expect(visibleRemovals.map((item) => item.id)).toEqual([removals[index]!.id]);
        const visibleBatches = await listCanonicalBatchValueChangesForAuth(db, actor, { projectId, status: "pending" });
        expect(visibleBatches.map((item) => item.id)).toEqual([batches[index]!.id]);
        const visibleSingles = await listCanonicalValueChangesForAuth(db, actor, { projectId, status: "pending" });
        expect(new Set(visibleSingles.map((item) => item.id))).toEqual(new Set(singles.map((item) => item.id)));
        const ids = new Set([...visibleRemovals, ...visibleBatches, ...visibleSingles]
          .filter((item) => item.submitterUserId !== actor.user.id).map((item) => item.id));
        expect(ids.size).toBe(4);
        return ids;
      };
      for (const actor of [a, b]) {
        const ids = await census(actor);
        expect((await queue(actor.user.id)).reviewQueue).toBe(ids.size);
        expect((await queue(actor.user.id, { projectId: null, authorizedProjectIds: null })).reviewQueue).toBe(ids.size);
        for (const excluded of [{ authorizedProjectIds: [] }, { reviewableProjectIds: [] }, { projectId: "excluded-project" }, { organizationId: "excluded-tenant" }]) {
          expect((await queue(actor.user.id, excluded)).reviewQueue).toBe(0);
        }
        expect((await queue(actor.user.id)).waitingMerge).toBe(0);
      }
      const otherProjectId = "counter-other-project", foreignOrgId = "counter-foreign-org", foreignProjectId = "counter-foreign-project";
      await db.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'Other counter','OTHER','initialized')", [otherProjectId, organizationId]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values('counter-other-review',$1,$2,$3,'software-committer')", [bId, organizationId, otherProjectId]);
      const other = await single(bId, c, otherProjectId);
      expect((await queue(aId, { projectId: null, authorizedProjectIds: null, reviewableProjectIds: [projectId, otherProjectId] })).reviewQueue).toBe(5);
      expect((await queue(aId, { projectId: null, reviewableProjectIds: [projectId, otherProjectId] })).reviewQueue).toBe(4);
      expect((await queue(aId, { reviewableProjectIds: [projectId, otherProjectId] })).reviewQueue).toBe(4);
      await db.query("insert into organizations(id,name) values($1,'Foreign counter')", [foreignOrgId]);
      await db.query("insert into users(id,organization_id,name,title,is_active) values('counter-foreign-admin',$1,'Foreign','Admin',true),('counter-foreign-review',$1,'Foreign review','Software',true)", [foreignOrgId]);
      await db.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'Foreign counter','FOREIGN','initialized')", [foreignProjectId, foreignOrgId]);
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
        ('counter-foreign-admin-role','counter-foreign-admin',$1,null,'admin'),
        ('counter-foreign-review-role','counter-foreign-review',$1,$2,'software-committer')`, [foreignOrgId, foreignProjectId]);
      const foreign = await getAuthContext(db, "counter-foreign-admin");
      const module = await createParameterModuleForAuth(db, foreign, { name: "Counter configuration", kind: "business" });
      const registration = await executeRegistration(getRootPostgresPool(db)!, { kind: "register", organizationId: foreignOrgId,
        subjectId: CatalogSubjectId("csub_dashboard_counter"), subjectKind: "configuration-schema", expectedRelease: snapshot.release,
        placement: { mode: "use-default" }, destinationModuleId: module.id, method: "explicit", proof: { reason: "Dashboard counter isolation" },
        idempotencyKey: "counter-foreign-registration", context: { actorKind: "org-admin", principalId: foreign.user.id } });
      expect(registration.ok).toBe(true);
      const foreignRequest = await single("counter-foreign-review", foreign, foreignProjectId);
      expect((await queue(aId, { projectId: null, authorizedProjectIds: null, reviewableProjectIds: [projectId, otherProjectId, foreignProjectId] })).reviewQueue).toBe(5);
      expect((await queue(aId, { projectId: foreignProjectId, authorizedProjectIds: null, reviewableProjectIds: [foreignProjectId] })).reviewQueue).toBe(0);
      const own = await single(bId, a);
      expect((await queue(aId)).reviewQueue).toBe(4);
      expect((await queue(bId)).reviewQueue).toBe(5);
      expect((await withdrawCanonicalValueChange(db, a, { projectId, requestId: own.id, ...removalContext(a) })).status).toBe("withdrawn");
      expect((await queue(bId)).reviewQueue).toBe(4);
      expect((await reviewCanonicalMemberRemoval(db, storage, a, { projectId, requestId: removals[0]!.id,
        proofDigest: removals[0]!.proofDigest, decision: "reject", ...removalContext(a) })).status).toBe("rejected");
      expect((await queue(aId)).reviewQueue).toBe(3);
      expect((await queue(bId)).reviewQueue).toBe(4);
      const failure = new Error("dashboard query failed");
      const failedDb = { query: vi.fn().mockRejectedValue(failure), transaction: vi.fn() } as unknown as Database;
      await expect(aggregateWorkbenchSignals(failedDb, { ...scope, userId: aId })).rejects.toBe(failure);
      if (process.env.WISEEFF_DASHBOARD_COUNTER_EVIDENCE_ROOT) {
        await writeFile(join(process.env.WISEEFF_DASHBOARD_COUNTER_EVIDENCE_ROOT, "producer-receipts.json"), JSON.stringify({
          label: "local native PostgreSQL bootstrap; repository scopes, not application LOGIN/API/browser acceptance",
          removals, batches, singles, other, foreignRequest, own,
          finalSignals: { a: await queue(aId), b: await queue(bId) }
        }, null, 2));
      }
    } finally {
      await db.close();
      await lane.drop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

describe.skipIf(!databaseAvailable)("dashboard repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("does not count legacy semantic rows as canonical KPIs", async () => {
    const kpis = await countKpis(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(kpis.totalParameters).toBe(0);
    expect(kpis.totalBindings).toBe(0);
    expect(kpis.totalDefinitions).toBe(0);
    expect(kpis.managedProjects).toBeGreaterThan(0);
    expect(kpis.highRiskParameters).toBeNull();
    expect(kpis.riskAvailability).toBe("unavailable");
  });

  it("aggregates trend into zero-filled day buckets", async () => {
    const points = await aggregateTrend(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z",
      granularity: "day"
    });
    expect(points.length).toBe(30);
    expect(points.every((p) => typeof p.changeCount === "number")).toBe(true);
  });

  it("does not derive risk distribution from legacy semantic rows", async () => {
    const buckets = await aggregateRiskDistribution(db, { organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId, projectId: null });
    expect(buckets).toEqual([]);
  });

  it("aggregates workbench signals", async () => {
    const signals = await aggregateWorkbenchSignals(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      userId: PARAMETER_DASHBOARD_FIXTURE.activeUserId,
      projectId: null,
      authorizedProjectIds: null,
      reviewableProjectIds: []
    });
    expect(signals.reviewQueue).toBeGreaterThanOrEqual(0);
    expect(signals.inactiveAccounts).toBeGreaterThanOrEqual(0);
  });

  it("counts personal KPIs scoped by user, project and window", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            contribution_count: "0",
            workflow_count: "0",
            high_risk_touch_count: "2"
          }
        ],
        rowCount: 1
      });
    const mockDb = {
      query,
      transaction: vi.fn()
    } as unknown as Database;

    const result = await countPersonalKpis(mockDb, {
      organizationId: "org-chargelab",
      projectId: "aurora",
      userId: "u-xu-yun",
      windowStart: "2026-06-01T00:00:00Z",
      windowEnd: "2026-07-01T00:00:00Z",
      perspectiveRoleId: "software-user",
      workbenchSignals: {
        reviewQueue: 5,
        myDrafts: 4,
        returnedChanges: 2,
        waitingMerge: 1,
        unappliedImportBatches: 6,
        inactiveAccounts: 7
      },
      roleLevel: "user"
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("parameter_catalog.binding_history_events history");
    expect(sql).toContain("public.project_parameter_value_change_requests request");
    expect(sql).not.toContain("parameter_history_entries");
    expect(sql).not.toContain("parameter_change_requests");
    expect(args).toEqual([
      "org-chargelab",
      "aurora",
      null,
      "u-xu-yun",
      "2026-06-01T00:00:00Z",
      "2026-07-01T00:00:00Z"
    ]);

    expect(result).toEqual({
      contributionCount: 0,
      workflowCount: 0,
      highRiskTouchCount: null,
      openItemCount: 4,
      pendingTodoCount: 2,
      riskAvailability: "unavailable"
    });
  });

  it("aggregates personal trend with user-scoped filters", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          bucket_start: new Date("2026-07-01T00:00:00.000Z"),
          change_count: "4",
          workflow_event_count: "2"
        }
      ],
      rowCount: 1
    });
    const mockDb = {
      query,
      transaction: vi.fn()
    } as unknown as Database;

    const points = await aggregatePersonalTrend(mockDb, {
      organizationId: "org-chargelab",
      projectId: null,
      userId: "u-xu-yun",
      windowStart: "2026-07-01T00:00:00Z",
      windowEnd: "2026-07-02T00:00:00Z",
      granularity: "day",
      roleLevel: "user"
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("history.created_at");
    expect(sql).toContain("request.created_at");
    expect(sql).not.toContain("parameter_history_entries");
    expect(sql).not.toContain("parameter_change_requests");
    expect(args).toEqual([
      "2026-07-01T00:00:00Z",
      "2026-07-02T00:00:00Z",
      "org-chargelab",
      "u-xu-yun",
      null,
      null
    ]);
    expect(points).toEqual([
      {
        bucketStart: "2026-07-01T00:00:00.000Z",
        changeCount: 4,
        workflowEventCount: 2
      }
    ]);
  });

  it("counts committer personal KPIs from review decisions", async () => {
    const result = await countPersonalKpis(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      userId: PARAMETER_DASHBOARD_FIXTURE.activeUserId,
      windowStart: "2026-06-01T00:00:00.000Z",
      perspectiveRoleId: "hardware-committer",
      workbenchSignals: {
        reviewQueue: 0,
        myDrafts: 0,
        returnedChanges: 0,
        waitingMerge: 0,
        unappliedImportBatches: 0,
        inactiveAccounts: 0
      },
      roleLevel: "committer"
    });

    expect(result.contributionCount).toBe(0);
    expect(result.workflowCount).toBe(0);
    expect(result.highRiskTouchCount).toBeNull();
    expect(result.riskAvailability).toBe("unavailable");
    expect(result.openItemCount).toBeGreaterThanOrEqual(0);
  });
});
