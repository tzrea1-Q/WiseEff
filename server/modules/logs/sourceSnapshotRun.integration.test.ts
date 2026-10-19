import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer, type AnalyzeLogInput } from "./analyzer";
import { createLogSkill, publishLogSkill, saveLogSkillDraft } from "./skillsService";
import { createLocalObjectStore } from "./objectStore";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("pinned source snapshot run over PostgreSQL", () => {
  it("completes while the pinned default is indexing, recording source provenance and the unavailable note", async () => {
    const ephemeral = await createEphemeralTestDatabase("sourcerun");
    const db = createPostgresDatabase(ephemeral.url);
    const objectRoot = await mkdtemp(join(tmpdir(), "log-source-run-"));
    try {
      await seedCoreGraph(db, { organization: { id: "org-source-run", name: "Source run" },
        users: [{ id: "source-admin", name: "Administrator" }] });
      const auth = makeTestAuthContext({ organizationId: "org-source-run", userId: "source-admin",
        roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
      const invocation = createUserInvocation(auth);
      const context = { requestId: "source-run-test" };
      const skill = await createLogSkill(db, auth, { name: "Source-aware skill" }, invocation, context);
      await db.query(`insert into log_source_snapshots
        (id, organization_id, skill_id, version_label, storage_key, file_name, status)
        values ('source-pinned', $1, $2, 'v1', 'unused/source.tgz', 'source.tgz', 'indexing')`, ["org-source-run", skill.id]);
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", defaultSourceSnapshotId: "source-pinned" },
        null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);

      const objectStore = createLocalObjectStore(objectRoot);
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const uploaded = await requestJson<{ job: { id: string; runId: string } }>(createHttpServer(router), "/api/v1/log-files", {
        method: "POST", body: JSON.stringify({ fileName: "run.log", contentType: "text/plain", skillId: skill.id,
          contentBase64: Buffer.from("INFO ordinary operation\n").toString("base64") })
      });
      expect(uploaded.status).toBe(201);
      // A later publication removes the default. This queued run must still use its own revision.
      const replacement = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1" }, null, draft.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, replacement.id, invocation, context);
      let observed: AnalyzeLogInput["sourceSnapshot"];
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, analyzer: {
        async analyze(input) { observed = input.sourceSnapshot; return createRuleBasedLogAnalyzer().analyze(input); }
      } })).toEqual({ status: "processed" });
      expect(observed).toEqual({ id: "source-pinned", status: "indexing" });
      expect((await db.query(`select status, skill_revision_id, source_snapshot_id, source_snapshot_status
        from log_analysis_runs where id = $1`, [uploaded.body.job.runId])).rows).toEqual([{
        status: "complete", skill_revision_id: draft.id, source_snapshot_id: "source-pinned", source_snapshot_status: "indexing"
      }]);
      expect((await db.query<{ conclusion: string }>("select conclusion from log_analysis_reports where run_id = $1", [uploaded.body.job.runId]))
        .rows[0].conclusion).toContain("源码快照仍在索引，本次分析未使用源码");
    } finally {
      await db.close();
      await ephemeral.drop();
      await rm(objectRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
