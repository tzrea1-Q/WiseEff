import { describe, expect, it, vi } from "vitest";
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
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { createRuleBasedLogAnalyzer, type LogAnalysisAdapter } from "./analyzer";
import type { getLogSkill } from "./skillsService";
import type { LogSkillRevisionDto } from "./skillsRepository";
import type { LogRecordDto } from "./types";
import type { z } from "zod";
import type { logSkillDryRunDetailResponseSchema } from "../contracts/dtoSchemas/logs";
import type { LogAnalysisTraceStep } from "./traceTypes";
import { persistLogTraceStep } from "./traceRepository";

const available = await isTestDatabaseAvailable();
type Skill = Awaited<ReturnType<typeof getLogSkill>>;
type Dry = z.infer<typeof logSkillDryRunDetailResponseSchema>;
type Upload = { log: LogRecordDto; job: { id: string; runId: string } };

describe.skipIf(!available)("run traces and isolated draft dry runs over PostgreSQL", () => {
  it("persists private ordered traces, rejects readers/other tenants and pins the draft and sample without creating logs", async () => {
    const ephemeral = await createEphemeralTestDatabase("trace");
    const db = createPostgresDatabase(ephemeral.url);
    const objectStore = createMemoryObjectStore();
    const admin = makeTestAuthContext({ organizationId: "trace-org", userId: "trace-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    let currentAuth = admin;
    const procedure = "PRIVATE_PROCEDURE_1230_DO_NOT_PERSIST_IN_TRACES";
    const observed: string[] = [];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    let dryStarted = false;
    const analyzer: LogAnalysisAdapter = { async analyze(input) {
      if (input.filePath === "sample.log") { dryStarted = true; await blocked; }
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "read_line_range", args: { file: input.filePath, startLine: 1, endLine: 2 } }, usage: { inputTokens: 12, outputTokens: 8 } },
        { content: { action: "final", conclusion: "Thermal foldback.", impact: "Slow charging.", severity: "Warning", confidence: 0.9,
          suggestedActions: ["Check cooling."], evidence: [{ filePath: input.filePath, lineNumbers: [2], inference: "Thermal signal.", suggestedAction: "Check cooling." }] } }
      ]);
      const report = await createAgentLoopLogAnalyzer({ model, modelLabel: "trace-scripted", maxSteps: 3, tokenBudget: 100_000 }).analyze(input);
      observed.push(model.calls[0][0].content);
      return report;
    } };
    const router = createRouter();
    registerLogRoutes(router, { db, objectStore, analyzer, getCurrentAuthContext: () => currentAuth });
    const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
      await seedCoreGraph(db, { organization: { id: admin.organization.id, name: "Trace" }, users: [{ id: admin.user.id, name: "Admin" }] });
      await seedCoreGraph(db, { organization: { id: "other-org", name: "Other tenant" }, users: [{ id: "other-admin", name: "Other admin" }] });
      const skill = (await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Trace skill" })).body.item;
      const base = `/api/v1/log-skills/${skill.id}`;
      const draft = (await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { ...skill.currentRevision.spec, procedure }, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      })).body.item;
      await request(`${base}/publish`, "POST", { draftRevisionId: draft.id });
      const upload = await request<Upload>("/api/v1/log-files", "POST", { fileName: "device.log", contentType: "text/plain", skillId: skill.id,
        contentBase64: Buffer.from("INFO boot\nERROR thermal foldback\n").toString("base64") });
      expect(upload.status).toBe(201);
      expect(await processLogAnalysisJobById({ db, objectStore, analyzer, jobId: upload.body.job.id })).toEqual({ status: "processed" });
      const tracePath = `/api/v1/logs/${upload.body.log.id}/trace`;
      const trace = await request<{ steps: LogAnalysisTraceStep[] }>(tracePath);
      expect(trace.status).toBe(200);
      expect(trace.body.steps.map((step) => step.index)).toEqual([1, 2, 3]);
      expect(trace.body.steps.map((step) => step.kind)).toEqual(["model-turn", "tool-call", "model-turn"]);
      expect(trace.body.steps[0]).toMatchObject({ inputTokens: 12, outputTokens: 8 });
      expect(trace.body.steps[1].lines).toContainEqual({ file: "device.log", line: 2 });
      expect(observed[0]).toContain(procedure);
      async function assertPrivate() {
        const persisted = JSON.stringify((await db.query("select step from log_analysis_trace_steps where organization_id=$1 order by step_index", [admin.organization.id])).rows);
        for (const marker of [procedure, "You are the WiseEff", "SKILL_DIAGNOSTIC_PROCEDURE", "single strict JSON", "role\":\"system", "Thermal foldback."]) expect(persisted).not.toContain(marker);
      }
      await assertPrivate();
      currentAuth = { ...admin, permissions: ["logs:view"] };
      expect((await request(tracePath)).status).toBe(403);
      expect((await request(`${base}/dry-runs`, "POST")).status).toBe(403);
      currentAuth = makeTestAuthContext({ organizationId: "other-org", userId: "other-admin", permissions: ["logs:view", "logs:admin-domains"] });
      expect((await request(tracePath)).status).toBe(404);
      expect((await request(`${base}/dry-runs`, "POST")).status).toBe(404);
      currentAuth = admin;
      const dryDraft = (await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { ...draft.spec, procedure: `${procedure}_DRAFT` }, baseDraftRevisionId: null, basePublishedRevisionId: draft.id
      })).body.item;
      expect((await request(`${base}/sample`, "PUT", { fileName: "sample.log", contentBase64: Buffer.from("INFO original sample\nERROR thermal foldback\n").toString("base64") })).status).toBe(200);
      const before = (await request<{ items: LogRecordDto[] }>("/api/v1/logs")).body;
      const beforeCounts = (await db.query(`select (select count(*)::int from log_records) records,
        (select count(*)::int from log_analysis_runs) runs, (select count(*)::int from jobs) jobs,
        (select count(*)::int from log_webhook_outbox) webhooks`)).rows;
      const started = await request<Dry>(`${base}/dry-runs`, "POST");
      expect(started.status).toBe(202);
      expect(started.body.run).toMatchObject({ status: "processing", skillRevisionId: dryDraft.id, report: null });
      await vi.waitFor(() => expect(dryStarted).toBe(true));
      expect((await request(`${base}/dry-runs`, "POST")).status).toBe(429);
      // Edits after admission cannot change the draft or sample used by this run.
      await request(`${base}/draft`, "PUT", { spec: { ...draft.spec, procedure: "NEWER_DRAFT" }, baseDraftRevisionId: dryDraft.id, basePublishedRevisionId: draft.id });
      await request(`${base}/sample`, "PUT", { fileName: "sample.log", contentBase64: Buffer.from("INFO replacement sample\nERROR replacement\n").toString("base64") });
      const dryPath = `${base}/dry-runs/${started.body.run.id}`;
      unblock();
      await vi.waitFor(async () => expect((await request<Dry>(dryPath)).body.run.status).toBe("complete"));
      const finished = (await request<Dry>(dryPath)).body;
      expect(finished.run).toMatchObject({ skillRevisionId: dryDraft.id, progress: 100, report: { conclusion: "Thermal foldback.", evidence: [{ filePath: "sample.log", lineNumbers: [2] }] } });
      expect(finished.steps.map((step) => step.index)).toEqual([1, 2, 3]);
      expect(observed[1]).toContain(`${procedure}_DRAFT`);
      expect(observed[1]).not.toContain("NEWER_DRAFT");
      expect((await request<{ item: { lines: { content: string }[] } }>(`${dryPath}/lines?file=sample.log&startLine=1&endLine=2`)).body.item.lines[0].content).toBe("INFO original sample");
      expect((await request("/api/v1/logs")).body).toEqual(before);
      // The list API has no search parameter; its complete searchable dataset stays identical.
      expect((await db.query(`select (select count(*)::int from log_records) records,
        (select count(*)::int from log_analysis_runs) runs, (select count(*)::int from jobs) jobs,
        (select count(*)::int from log_webhook_outbox) webhooks`)).rows).toEqual(beforeCounts);
      await assertPrivate();
      currentAuth = { ...admin, permissions: ["logs:view"] };
      expect((await request(dryPath)).status).toBe(403);
      expect((await request(`${dryPath}/lines?file=sample.log&startLine=1&endLine=2`)).status).toBe(403);
      currentAuth = makeTestAuthContext({ organizationId: "other-org", userId: "other-admin", permissions: ["logs:view", "logs:admin-domains"] });
      expect((await request(dryPath)).status).toBe(404);
      expect((await request(`${dryPath}/lines?file=sample.log&startLine=1&endLine=2`)).status).toBe(404);
      await expect(db.query("insert into log_analysis_trace_steps (organization_id, run_id, step_index, step) values ($1,$2,1,'{}')", ["other-org", upload.body.job.runId])).rejects.toThrow();
      await expect(db.query("insert into log_analysis_trace_steps (organization_id, run_id, step_index, step) values ($1,$2,201,'{}')", [admin.organization.id, upload.body.job.runId])).rejects.toThrow();
      await db.query("update jobs set status='processing', lease_owner='replacement', lease_expires_at=now()+interval '1 minute' where id=$1", [upload.body.job.id]);
      const write = { organizationId: admin.organization.id, runId: upload.body.job.runId, jobId: upload.body.job.id, step: trace.body.steps[0] };
      expect(await persistLogTraceStep(db, { ...write, leaseOwner: "stale-worker" })).toBe(false);
      expect((await db.query("select step_index from log_analysis_trace_steps where run_id=$1 order by step_index", [upload.body.job.runId])).rows).toEqual([{ step_index: 1 }, { step_index: 2 }, { step_index: 3 }]);
      // A valid replacement attempt clears the longer old tail, a stale one cannot.
      expect(await persistLogTraceStep(db, { ...write, leaseOwner: "replacement" })).toBe(true);
      expect((await db.query("select step_index from log_analysis_trace_steps where run_id=$1", [upload.body.job.runId])).rows).toEqual([{ step_index: 1 }]);
    } finally { unblock(); await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("bounds dry-run retention and times out an unresponsive analyzer", async () => {
    const ephemeral = await createEphemeralTestDatabase("tracebounds");
    const db = createPostgresDatabase(ephemeral.url);
    const store = createMemoryObjectStore();
    const auth = makeTestAuthContext({ organizationId: "bounds-org", userId: "bounds-admin", permissions: ["logs:view", "logs:admin-domains"] });
    let hang = false;
    let finishHanging: (() => void) | undefined;
    const router = createRouter();
    registerLogRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => auth,
      analyzer: { async analyze(input) {
        if (hang) await new Promise<void>((resolve) => { finishHanging = resolve; });
        return createRuleBasedLogAnalyzer().analyze(input);
      } } });
    const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Bounds" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = (await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Bounded skill" })).body.item;
      const base = `/api/v1/log-skills/${skill.id}`;
      expect((await request(`${base}/dry-runs`, "POST")).status).toBe(409);
      await request(`${base}/draft`, "PUT", { spec: skill.currentRevision.spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id });
      expect((await request(`${base}/dry-runs`, "POST")).status).toBe(409);
      await request(`${base}/sample`, "PUT", { fileName: "sample.log", contentBase64: Buffer.from("ERROR example\n").toString("base64") });
      let oldest = "";
      for (let index = 0; index < 11; index++) {
        const started = await request<Dry>(`${base}/dry-runs`, "POST");
        expect(started.status).toBe(202);
        oldest ||= started.body.run.id;
        await vi.waitFor(async () => expect((await request<Dry>(`${base}/dry-runs/${started.body.run.id}`)).body.run.status).toBe("complete"));
      }
      expect((await db.query("select count(*)::int n from log_skill_dry_runs where skill_id=$1", [skill.id])).rows).toEqual([{ n: 10 }]);
      expect((await request(`${base}/dry-runs/${oldest}`)).status).toBe(404);
      expect((await db.query("select count(*)::int n from log_analysis_trace_steps where dry_run_id=$1", [oldest])).rows).toEqual([{ n: 0 }]);
      hang = true;
      vi.stubEnv("LOG_ANALYSIS_JOB_MAX_MS", "100");
      const timeout = await request<Dry>(`${base}/dry-runs`, "POST");
      expect(timeout.status).toBe(202);
      await vi.waitFor(async () => expect((await request<Dry>(`${base}/dry-runs/${timeout.body.run.id}`)).body.run).toMatchObject({ status: "failed", error: "服务重启，试运行已中断" }));
    } finally { finishHanging?.(); vi.unstubAllEnvs(); await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
