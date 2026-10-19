import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { createAgentLoopLogAnalyzer, LOG_ANALYSIS_LOOP_PROMPT_VERSION } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import type { getLogSkill } from "./skillsService";
import type { LogSkillRevisionDto } from "./skillsRepository";
import type { LogRecordDto } from "./types";

const available = await isTestDatabaseAvailable();
type Skill = Awaited<ReturnType<typeof getLogSkill>>;
type Upload = { log: LogRecordDto; job: { id: string; runId: string } };

describe.skipIf(!available)("diagnostic procedures over PostgreSQL", () => {
  it("uses the published procedure for queued and pinned runs while new uploads use the next publication", async () => {
    const ephemeral = await createEphemeralTestDatabase("procedure");
    const db = createPostgresDatabase(ephemeral.url);
    const objectStore = createMemoryObjectStore();
    const auth = makeTestAuthContext({ organizationId: "procedure-org", userId: "procedure-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    const firstProcedure = "## Scope\nInspect the cooling path before judging thermal foldback.";
    const nextProcedure = "## Scope\nCompare the fan speed with the thermal foldback window.";
    const unpublishedProcedure = "## Scope\nUnpublished draft: inspect the ambient temperature.";
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Procedure" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Thermal procedure", formatProfile: {} });
      expect(created.status).toBe(201);
      const skill = created.body.item;
      const base = `/api/v1/log-skills/${skill.id}`;
      const draft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { ...skill.currentRevision.spec, procedure: firstProcedure }, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      });
      expect(draft.status).toBe(200);
      const published = await request<{ item: Skill }>(`${base}/publish`, "POST", { draftRevisionId: draft.body.item.id });
      expect(published.status).toBe(200);
      const firstRevision = published.body.item.currentRevision;
      const uploadBody = { fileName: "device.log", contentType: "text/plain", skillId: skill.id,
        contentBase64: Buffer.from("INFO boot\nERROR code=E_THERMAL_FOLDBACK charge_current_ma=2000\n").toString("base64") };
      const queued = await request<Upload>("/api/v1/log-files", "POST", uploadBody);
      expect(queued.status).toBe(201);
      expect(queued.body.log.skillRevision).toEqual({ id: firstRevision.id, number: firstRevision.number });

      // Saving a different procedure after upload cannot change the queued run.
      const nextDraft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { ...firstRevision.spec, procedure: nextProcedure }, baseDraftRevisionId: null, basePublishedRevisionId: firstRevision.id
      });
      expect(nextDraft.status).toBe(200);
      async function process(upload: Upload, revision: LogSkillRevisionDto) {
        const model = createScriptedLogAnalysisModel([
          { content: { action: "tool", tool: "read_line_range", args: { file: "device.log", startLine: 1, endLine: 2 } } },
          { content: { action: "final", conclusion: "Thermal foldback reduced charging current.", impact: "Charging is slower.", severity: "Warning", confidence: 0.9,
            suggestedActions: ["Inspect cooling."], evidence: [{ filePath: "device.log", lineNumbers: [2], inference: "The log reports thermal foldback.", suggestedAction: "Inspect cooling." }] } }
        ]);
        const analyzer = createAgentLoopLogAnalyzer({ model, modelLabel: "procedure-scripted", maxSteps: 3, tokenBudget: 100_000 });
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: upload.job.id, analyzer })).toEqual({ status: "processed" });
        const prompt = model.calls[0].find((message) => message.role === "system")?.content;
        expect(prompt).toContain(JSON.stringify(revision.spec.procedure));
        for (const procedure of [firstProcedure, nextProcedure, unpublishedProcedure]) {
          if (procedure !== revision.spec.procedure) expect(prompt).not.toContain(JSON.stringify(procedure));
        }
        const report = await request<{ item: LogRecordDto }>(`/api/v1/logs/${upload.log.id}`);
        expect(report.status).toBe(200);
        expect(report.body.item).toMatchObject({ status: "complete", analysisSource: "agent",
          skillRevision: { id: revision.id, number: revision.number },
          evidence: [{ filePath: "device.log", lineNumbers: [2] }] });
        expect((await db.query(`select r.skill_revision_id, p.prompt_version, p.analysis_source, p.model
          from log_analysis_runs r join log_analysis_reports p on p.run_id = r.id where r.id = $1`, [upload.job.runId])).rows)
          .toEqual([{ skill_revision_id: revision.id, prompt_version: LOG_ANALYSIS_LOOP_PROMPT_VERSION, analysis_source: "agent", model: "procedure-scripted" }]);
        return prompt;
      }
      const firstPrompt = await process(queued.body, firstRevision);

      const nextPublished = await request<{ item: Skill }>(`${base}/publish`, "POST", { draftRevisionId: nextDraft.body.item.id });
      expect(nextPublished.status).toBe(200);
      const nextRevision = nextPublished.body.item.currentRevision;
      expect(nextRevision).toMatchObject({ id: nextDraft.body.item.id, number: firstRevision.number + 1, spec: { procedure: nextProcedure } });
      expect((await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { ...nextRevision.spec, procedure: unpublishedProcedure }, baseDraftRevisionId: null, basePublishedRevisionId: nextRevision.id
      })).status).toBe(200);

      // A rerun explicitly pinned to the original run survives both publication and newer draft edits.
      const pinned = await request<Upload>(`/api/v1/logs/${queued.body.log.id}/rerun`, "POST", { revisionPolicy: "pinned" });
      expect(pinned.status).toBe(200);
      expect(await process(pinned.body, firstRevision)).toBe(firstPrompt);

      const newUpload = await request<Upload>("/api/v1/log-files", "POST", uploadBody);
      expect(newUpload.status).toBe(201);
      expect(newUpload.body.log.skillRevision).toEqual({ id: nextRevision.id, number: nextRevision.number });
      await process(newUpload.body, nextRevision);
    } finally {
      await db.close();
      await ephemeral.drop();
    }
  }, 120_000);
});
