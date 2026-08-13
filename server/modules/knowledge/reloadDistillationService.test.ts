import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import type { ReloadRunStatus, ReloadSnapshotDto } from "../dts-reload/types";
import { insertReloadRun, insertReloadRunTarget } from "../dts-reload/repository";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import {
  createAgentKnowledgeDraft,
  distillKnowledgeFromReloadRun,
  publishKnowledgeEntry,
  searchKnowledge
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-reload";
const OTHER_ORG_ID = "org-kb-reload-other";
const PROJECT_ID = "project-kb-reload";
const EDITOR = "user-kbr-editor";
const NO_RELOAD_READ = "user-kbr-no-reload-read";
const VIEWER = "user-kbr-viewer";
const OTHER_ORG_EDITOR = "user-kbr-foreign";

const editorPermissions: BackendPermission[] = ["knowledge:view", "knowledge:edit", "debugging:view"];
const committerPermissions: BackendPermission[] = ["knowledge:view", "knowledge:edit", "debugging:dts-reload"];
const knowledgeEditOnly: BackendPermission[] = ["knowledge:view", "knowledge:edit"];
const reloadReadOnly: BackendPermission[] = ["knowledge:view", "debugging:view"];

function makeAuth(userId: string, permissions: BackendPermission[], organizationId = ORG_ID): AuthContext {
  return {
    user: { id: userId, organizationId, name: userId, title: "Engineer", isActive: true },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

function snapshotFixture(): ReloadSnapshotDto {
  return {
    libraryBaselines: [
      { bindingId: "binding-kbr", propertyKey: "watchdog_time", nodePath: "/node", baselineValue: "<6000>" }
    ],
    artifactDigest: { sha256: "art-sha", onDeviceDigest: "art-sha", integrityCheck: "sha256" },
    kernelSignal: {
      command: "dmesg",
      captureStatus: "obtained",
      captureError: null,
      rawText: "kernel: watchdog_time applied\n",
      truncated: false,
      matchedByParameter: [
        { parameterName: "watchdog_time", bindingId: "binding-kbr", lines: ["kernel: watchdog_time applied"] }
      ],
      excerpt: null
    },
    behaviouralVerification: {
      outcomes: [
        {
          bindingId: "binding-kbr",
          propertyKey: "watchdog_time",
          outcome: "unbound",
          debugNodeId: null,
          nodePath: null,
          expectedValue: "<7000>",
          readValue: null,
          reason: "No readable debug-node binding for this parameter and protocol."
        }
      ]
    }
  };
}

describe.skipIf(!databaseAvailable)("knowledge reload distillation service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: ORG_ID, name: "KB Reload Org" },
      users: [{ id: EDITOR }, { id: NO_RELOAD_READ }, { id: VIEWER }],
      projects: [{ id: PROJECT_ID }]
    });
    await seedCoreGraph(db, {
      organization: { id: OTHER_ORG_ID, name: "KB Reload Other Org" },
      users: [{ id: OTHER_ORG_EDITOR }]
    });
    await seedSpecBindingGraph(db, {
      organizationId: ORG_ID,
      specs: [
        {
          id: "spec-kbr",
          specificationKey: "reload/kbr/watchdog_time",
          versions: [{ id: "psv-kbr", displayName: "Watchdog" }],
          propertySpec: { id: "dps-kbr", propertyKey: "watchdog_time" }
        }
      ],
      modules: [{ id: "mod-kbr", name: "charger" }],
      bindings: [
        { id: "binding-kbr", projectId: PROJECT_ID, parameterSpecId: "spec-kbr", moduleId: "mod-kbr" }
      ]
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  async function seedReloadRun(input: {
    id: string;
    status?: ReloadRunStatus;
    withSnapshot?: boolean;
    failureCode?: string | null;
  }) {
    await insertReloadRun(db, {
      id: input.id,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      configRevisionId: null,
      status: input.status ?? "unverifiable",
      purpose: "ordinary",
      restoresSourceRunId: null,
      failureCode: input.failureCode ?? null,
      steps: [],
      diagnostics: [],
      toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
      overlaySourceStorageKey: null,
      overlaySourceSha256: null,
      overlayArtifactStorageKey: "overlay.dtbo",
      overlayArtifactSha256: "art-sha",
      overlayArtifactBytes: 64,
      createdByUserId: EDITOR,
      completedAt: new Date().toISOString()
    });
    await insertReloadRunTarget(db, {
      id: `target-${input.id}`,
      reloadRunId: input.id,
      bindingId: "binding-kbr",
      nodePath: "/node",
      propertyKey: "watchdog_time",
      baselineValue: "<6000>",
      debugValue: "<7000>",
      sortOrder: 0
    });
    if (input.withSnapshot !== false) {
      await db.query(
        `update dts_reload_runs
         set reload_snapshot = $2::jsonb, device_id = 'bridge:lab', target_ref = 'AURORA-01', bridge_machine_label = 'Lab Bridge'
         where id = $1`,
        [input.id, JSON.stringify(snapshotFixture())]
      );
    }
  }

  async function listAuditEvents(entryId: string) {
    const result = await db.query<{
      kind: string;
      action: string;
      actor_type: string;
      trace_id: string;
      metadata: Record<string, unknown>;
    }>(
      `select kind, action, actor_type, trace_id, metadata from audit_events where organization_id = $1 and target_id = $2 order by created_at asc`,
      [ORG_ID, entryId]
    );
    return result.rows;
  }

  describe("distillKnowledgeFromReloadRun", () => {
    it("creates a pre-filled draft with revision 1, reload source linkage, tags, and audit via the seam", async () => {
      await seedReloadRun({ id: "run-kbr-ok" });
      const auth = makeAuth(EDITOR, editorPermissions);

      const entry = await distillKnowledgeFromReloadRun(db, auth, { runId: "run-kbr-ok" }, { requestId: "req-kbr-1" });

      expect(entry.status).toBe("draft");
      expect(entry.contentForm).toBe("markdown");
      expect(entry.title).toBe("参数调试重载:watchdog_time(bridge:lab · AURORA-01)");
      expect(entry.tags).toEqual(["参数调试", "DTS重载", "不可验证"]);
      expect(entry.sourceType).toBe("human");
      expect(entry.sourceLogId).toBeNull();
      expect(entry.sourceReloadRunId).toBe("run-kbr-ok");
      expect(entry.headRevisionNumber).toBe(1);
      expect(entry.createdByUserId).toBe(EDITOR);
      // Honest outcome wording pinned end to end.
      expect(entry.contentMarkdown).toContain("不可验证:命令全部成功且产物完整落盘,但平台无法确认驱动观察到了新值——这不等于成功。");
      expect(entry.contentMarkdown).toContain("`<6000>` → `<7000>`");
      expect(entry.contentMarkdown).toContain("Overlay 产物 SHA256:`art-sha`");

      const audit = await listAuditEvents(entry.id);
      expect(audit).toEqual([
        expect.objectContaining({
          kind: "knowledge-entry-distill",
          action: "distill",
          actor_type: "user",
          trace_id: "req-kbr-1",
          metadata: expect.objectContaining({
            reloadRunId: "run-kbr-ok",
            projectId: PROJECT_ID,
            status: "unverifiable",
            purpose: "ordinary"
          })
        })
      ]);
    });

    it("accepts the debugging:dts-reload permission as the run read gate too", async () => {
      await seedReloadRun({ id: "run-kbr-committer" });

      const entry = await distillKnowledgeFromReloadRun(db, makeAuth(EDITOR, committerPermissions), {
        runId: "run-kbr-committer"
      });
      expect(entry.sourceReloadRunId).toBe("run-kbr-committer");
    });

    it("keeps the distilled draft out of retrieval until published", async () => {
      await seedReloadRun({ id: "run-kbr-retrieval" });
      const auth = makeAuth(EDITOR, editorPermissions);

      const entry = await distillKnowledgeFromReloadRun(db, auth, { runId: "run-kbr-retrieval" });
      const before = await searchKnowledge(db, auth, { q: "watchdog_time" });
      expect(before.items).toHaveLength(0);

      await publishKnowledgeEntry(db, auth, entry.id);
      const after = await searchKnowledge(db, auth, { q: "watchdog_time" });
      expect(after.items.map((item) => item.entryId)).toContain(entry.id);
    });

    it("requires knowledge:edit to create the draft", async () => {
      await seedReloadRun({ id: "run-kbr-perm" });

      await expect(
        distillKnowledgeFromReloadRun(db, makeAuth(VIEWER, reloadReadOnly), { runId: "run-kbr-perm" })
      ).rejects.toMatchObject({ code: "FORBIDDEN", details: { permission: "knowledge:edit" } });
    });

    it("requires the reload read gate on the source run", async () => {
      await seedReloadRun({ id: "run-kbr-gate" });

      await expect(
        distillKnowledgeFromReloadRun(db, makeAuth(NO_RELOAD_READ, knowledgeEditOnly), { runId: "run-kbr-gate" })
      ).rejects.toMatchObject({ code: "FORBIDDEN", details: { permission: "debugging:view" } });
    });

    it("enforces organization scope on the source run", async () => {
      await seedReloadRun({ id: "run-kbr-org" });

      await expect(
        distillKnowledgeFromReloadRun(db, makeAuth(OTHER_ORG_EDITOR, editorPermissions, OTHER_ORG_ID), {
          runId: "run-kbr-org"
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses non-terminal runs: nothing happened on a device yet", async () => {
      await seedReloadRun({ id: "run-kbr-validated", status: "validated", withSnapshot: false });

      await expect(
        distillKnowledgeFromReloadRun(db, makeAuth(EDITOR, editorPermissions), { runId: "run-kbr-validated" })
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { runId: "run-kbr-validated", status: "validated" }
      });
    });

    it("distils a failed run with the failure stated honestly", async () => {
      await seedReloadRun({ id: "run-kbr-failed", status: "failed", failureCode: "transfer-failed", withSnapshot: false });

      const entry = await distillKnowledgeFromReloadRun(db, makeAuth(EDITOR, editorPermissions), {
        runId: "run-kbr-failed"
      });
      expect(entry.tags).toContain("部署失败");
      expect(entry.contentMarkdown).toContain("部署失败:某个部署步骤失败,设备可能未应用(或部分应用)本次调试值。");
      expect(entry.contentMarkdown).toContain("失败码:`transfer-failed`");
    });
  });

  describe("createAgentKnowledgeDraft with sourceReloadRunId", () => {
    it("records the reload-run source after validating the run readably like the API path", async () => {
      await seedReloadRun({ id: "run-kbr-agent" });
      const auth = makeAuth(EDITOR, editorPermissions);

      const entry = await createAgentKnowledgeDraft(
        db,
        auth,
        {
          title: "重载调参经验",
          tags: ["参数调试"],
          contentMarkdown: "## 结论\n\nwatchdog 超时上调后不可验证,需补调试节点绑定。",
          sessionId: "xiaoze-session-kbr",
          sourceReloadRunId: "run-kbr-agent"
        },
        { requestId: "req-kbr-agent-1" }
      );

      expect(entry.sourceType).toBe("agent");
      expect(entry.sourceReloadRunId).toBe("run-kbr-agent");
      expect(entry.sourceLogId).toBeNull();

      const audit = await listAuditEvents(entry.id);
      expect(audit).toEqual([
        expect.objectContaining({
          kind: "knowledge-entry-agent-draft",
          actor_type: "agent",
          metadata: expect.objectContaining({ sourceReloadRunId: "run-kbr-agent", sessionId: "xiaoze-session-kbr" })
        })
      ]);
    });

    it("rejects linking a run the caller cannot read (reload read gate)", async () => {
      await seedReloadRun({ id: "run-kbr-agent-gate" });

      await expect(
        createAgentKnowledgeDraft(db, makeAuth(NO_RELOAD_READ, knowledgeEditOnly), {
          title: "越权来源",
          tags: [],
          contentMarkdown: "body",
          sessionId: "s-kbr-1",
          sourceReloadRunId: "run-kbr-agent-gate"
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN", details: { permission: "debugging:view" } });
    });

    it("rejects linking another organization's run", async () => {
      await seedReloadRun({ id: "run-kbr-agent-org" });

      await expect(
        createAgentKnowledgeDraft(db, makeAuth(OTHER_ORG_EDITOR, editorPermissions, OTHER_ORG_ID), {
          title: "越权来源",
          tags: [],
          contentMarkdown: "body",
          sessionId: "s-kbr-2",
          sourceReloadRunId: "run-kbr-agent-org"
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
