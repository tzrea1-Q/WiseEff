import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { applyTestMigrations, migrationsDir } from "../../testing/tempDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { getLogRecord, uploadLogFile } from "./service";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { LogAnalysisProviderError } from "./analyzer/llmAnalyzer";
import { logRecordDtoSchema } from "../contracts/dtoSchemas/logs";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { createLogSkill, saveLogSkillDraft, publishLogSkill, type getLogSkill } from "./skillsService";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createDeterministicLogAnalysisLoopModel, createDeterministicLogAnalysisModel } from "./analyzer/deterministicModel";
import { createLlmLogAnalyzer } from "./analyzer/llmAnalyzer";
import { parseLogText } from "./parser";
import { prefilterLogStream, runLogPrefilter } from "./prefilter";
import { defaultGoldenCasesRoot, loadGoldenLogCases } from "./eval/goldenCases";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import type { LogSkillRevisionDto } from "./skillsRepository";
import type { LogRecordDto } from "./types";
import { bootstrapLocalAdmin } from "../auth/bootstrapLocalAdmin";
import { seedM0Foundation } from "../../../scripts/seed-m0";
import { seedM1Parameters } from "../../../scripts/seed-m1-parameters";
import { seedM2Logs } from "../../../scripts/seed-m2-logs";

const available = await isTestDatabaseAvailable();
const authFor = (organizationId = "signals-org") => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze"] });

describe.skipIf(!available)("generic signals through upload, worker and HTTP report", () => {
  it("provisions published charging rules for post-migration organizations and repeats seeds without overwriting author changes", async () => {
    const ephemeral = await createEphemeralTestDatabase("chargingprovision");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      const created = await bootstrapLocalAdmin(db, { name: "Admin", username: "charging.admin", password: "WiseEff@2026" });
      const publication = async (organizationId: string) => db.query<{ name: string; spec: unknown; status: string }>(
        `select d.name, r.spec, r.status from log_domains d join log_skill_revisions r
          on (r.skill_id, r.organization_id) = (d.id, d.organization_id)
          where d.organization_id = $1 and d.id = $2 and r.status = 'published'`,
        [organizationId, `seed-charging:${organizationId}`]);
      const runtimeSeed = await publication(created.organizationId);
      expect(runtimeSeed.rows).toHaveLength(1);
      expect(runtimeSeed.rows[0]).toMatchObject({ name: "充电", status: "published" });
      const rules = logSkillSpecSchema.parse(runtimeSeed.rows[0].spec).signalRules!;
      expect(rules.rules.map((rule) => rule.name)).toEqual(["热降额", "充电限流", "通信超时", "设备离线", "错误码"]);
      expect({ ...rules, rules: rules.rules.map(({ name: _name, ...rule }) => rule) }).toEqual(defaultChargingRuleSet);
      await seedCoreGraph(db, { organization: { id: "charging-concurrent", name: "Concurrent provisioning" } });
      await Promise.all([db.query("select provision_charging_skill($1)", ["charging-concurrent"]),
        db.query("select provision_charging_skill($1)", ["charging-concurrent"])]);
      expect((await publication("charging-concurrent")).rows).toEqual(runtimeSeed.rows);
      for (let replay = 0; replay < 2; replay++) {
        await seedM0Foundation(db);
        await seedM1Parameters(db, { projects: [], parameterLibrary: [] });
        await seedM2Logs(db);
      }
      expect((await publication("org-chargelab")).rows).toEqual(runtimeSeed.rows);
      expect((await db.query(`select organization_id, count(*)::int as count from log_domains
        where id = 'seed-charging:' || organization_id and organization_id = any($1::text[])
        group by organization_id order by organization_id`, [[created.organizationId, "org-chargelab"]])).rows)
        .toEqual([created.organizationId, "org-chargelab"].sort().map((organization_id) => ({ organization_id, count: 1 })));
      expect((await db.query(`select organization_id, actor_type, actor_user_id, metadata from audit_events
        where id = any($1::text[]) order by organization_id`,
        [[`seed-charging-audit:${created.organizationId}`, "seed-charging-audit:org-chargelab"]])).rows)
        .toEqual([created.organizationId, "org-chargelab"].sort().map((id) => ({ organization_id: id, actor_type: "system", actor_user_id: null,
          metadata: { initiator: "system", systemKind: "service", systemName: "organization-provisioning", revisionId: `seed-charging-revision:${id}` } })));
      const auth = makeTestAuthContext({ organizationId: "org-chargelab", userId: "u-xu-yun",
        roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:admin-domains"] });
      const skillId = "seed-charging:org-chargelab";
      const draft = await saveLogSkillDraft(db, auth, skillId, { schemaVersion: "skill/v1", procedure: "Author procedure", signalRules: genericSignalRuleSet },
        null, "seed-charging-revision:org-chargelab", createUserInvocation(auth), { requestId: "author-seed-draft" });
      await publishLogSkill(db, auth, skillId, draft.id, createUserInvocation(auth), { requestId: "author-seed-publish" });
      const before = await db.query("select * from log_skill_revisions where skill_id = $1 order by id", [skillId]);
      await Promise.all([db.query("select provision_charging_skill($1)", ["org-chargelab"]),
        db.query("select provision_charging_skill($1)", ["org-chargelab"])]);
      await seedM0Foundation(db);
      expect((await db.query("select * from log_skill_revisions where skill_id = $1 order by id", [skillId])).rows).toEqual(before.rows);
      await expect(db.query("select provision_charging_skill($1)", ["missing-organization"])).rejects.toMatchObject({ code: "23503" });
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("seeds independent charging publications idempotently and preserves pre-migration rule evidence on every eval case", async () => {
    const ephemeral = await createEphemeralTestDatabase("chargingseed");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      for (const id of ["signals-org", "signals-other"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }]
      });
      const auth: ReturnType<typeof authFor> = { ...authFor(), permissions: [...authFor().permissions, "logs:admin-domains"] };
      const existing = await createLogSkill(db, auth, { name: "充电" }, createUserInvocation(auth), { requestId: "existing-charging" });
      const replaySeed = async () => {
        await db.query("delete from schema_migrations where name = '0196_seed_charging_skill.sql'");
        await applyTestMigrations(db, migrationsDir, { through: "0196_seed_charging_skill.sql" });
      };
      await replaySeed();
      const before = await db.query("select * from log_skill_revisions where id like 'seed-charging-revision:%' order by id");
      await replaySeed();
      expect((await db.query("select * from log_skill_revisions where id like 'seed-charging-revision:%' order by id")).rows).toEqual(before.rows);
      const seeds = await db.query<{ organization_id: string; spec: unknown; name: string }>(`select s.organization_id, s.spec, d.name
        from log_skill_revisions s join log_domains d on (d.id, d.organization_id) = (s.skill_id, s.organization_id)
        where s.id in ('seed-charging-revision:signals-org', 'seed-charging-revision:signals-other') order by s.organization_id`);
      expect(seeds.rows.map((row) => [row.organization_id, row.name])).toEqual([["signals-org", "充电 (2)"], ["signals-other", "充电"]]);
      expect((await db.query("select spec from log_skill_revisions where id=$1", [existing.currentRevision.id])).rows).toEqual([{ spec: existing.currentRevision.spec }]);
      const rules = logSkillSpecSchema.parse(seeds.rows[0].spec).signalRules!;
      expect(rules.rules.map((rule) => rule.name)).toEqual(["热降额", "充电限流", "通信超时", "设备离线", "错误码"]);
      expect({ ...rules, rules: rules.rules.map(({ name: _name, ...rule }) => rule) }).toEqual(defaultChargingRuleSet);
      expect(logSkillSpecSchema.parse(seeds.rows[1].spec).signalRules).toEqual(rules);
      const golden = loadGoldenLogCases(defaultGoldenCasesRoot());
      expect(golden.problems).toEqual([]);
      expect(golden.cases.length).toBeGreaterThan(0);
      for (const testCase of golden.cases) {
        const parsed = parseLogText({ fileName: "eval.log", content: testCase.logText }, { profile: testCase.formatProfile });
        if (!parsed.ok) throw new Error(`${testCase.id}: ${parsed.reason}`);
        const legacy = runLogPrefilter(parsed.entries);
        const seeded = await prefilterLogStream((async function* () { yield* parsed.entries; })(), rules);
        expect(seeded.evidence, testCase.id).toEqual(legacy.evidence);
        expect(seeded.ruleHits, testCase.id).toEqual(legacy.ruleHits);
        const analysisInput = { parsed, signalSummary: { signals: [], templates: [], truncatedSignals: false, truncatedTemplates: false } };
        expect(await createRuleBasedLogAnalyzer(rules).analyze(analysisInput), testCase.id)
          .toEqual(await createRuleBasedLogAnalyzer().analyze(analysisInput));
      }
      expect((await db.query(`select organization_id, actor_type, actor_user_id, metadata from audit_events
        where id in ('seed-charging-audit:signals-org', 'seed-charging-audit:signals-other') order by organization_id`)).rows)
        .toEqual(["signals-org", "signals-other"].map((id) => ({ organization_id: id, actor_type: "system", actor_user_id: null,
          metadata: { initiator: "system", systemKind: "migration", systemName: "0196_seed_charging_skill", revisionId: `seed-charging-revision:${id}` } })));
      await expect(db.query(`insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
        values ('foreign-charging-revision', 'signals-other', 'seed-charging:signals-org', 2, 'draft', '{"schemaVersion":"skill/v1"}', 'hash')`))
        .rejects.toMatchObject({ code: "23503" });
      await expect(db.query("update log_skill_revisions set spec = '{}' where id = 'seed-charging-revision:signals-org'"))
        .rejects.toThrow(/immutable/);
      await seedCoreGraph(db, { organization: { id: "seed-audit-failure", name: "Audit failure" } });
      await db.query(`alter table audit_events add constraint reject_charging_seed_audit
        check (id <> 'seed-charging-audit:seed-audit-failure') not valid`);
      await expect(replaySeed()).rejects.toMatchObject({ code: "23514" });
      expect((await db.query("select id from log_domains where id = 'seed-charging:seed-audit-failure'")).rows).toEqual([]);
      expect((await db.query("select id from log_skill_revisions where id = 'seed-charging-revision:seed-audit-failure'")).rows).toEqual([]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("publishes an author rule into signals and fallback evidence while later draft edits leave the queued revision pinned", async () => {
    const ephemeral = await createEphemeralTestDatabase("authorrules");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth: ReturnType<typeof authFor> = { ...authFor(), permissions: [...authFor().permissions, "logs:admin-domains"] };
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Author rules" }, users: [{ id: auth.user.id, name: "Admin" }] });
      let currentAuth = auth;
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      type Skill = Awaited<ReturnType<typeof getLogSkill>>;
      const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "Storage diagnostics" });
      expect(created.status).toBe(201);
      const skill = created.body.item, base = `/api/v1/log-skills/${skill.id}`;
      const spec: LogSkillSpec = { schemaVersion: "skill/v1",
        parsing: { schemaVersion: "parsing/v1", extractors: [{ id: "sensor", files: ["*.log"],
          pattern: "temperature=(?P<temperature>\\d+)", fields: { temperature: { type: "int" } } }] },
        signalRules: { ...genericSignalRuleSet, rules: [{
        id: "storage-full", anyOf: [{ type: "text", pattern: "STORAGE_FULL" }], stageId: "rootcause",
        name: "Storage capacity exhausted", severity: "Critical",
        inference: "Storage capacity exhausted", suggestedAction: "Free storage capacity",
        analysis: { conclusion: { value: "Legacy internal message", priority: 0 }, suggestedActions: [] }
      }, {
        id: "temperature-high", name: "Temperature high", severity: "Warning", stageId: "pattern",
        anyOf: [{ type: "field", field: "sensor.temperature", operator: "range", min: 90, max: 100 }],
        inference: "Sensor temperature requires review", suggestedAction: "Check cooling", analysis: { suggestedActions: [] }
      }, {
        id: "temperature-window", name: "Repeated temperature", severity: "Warning", stageId: "pattern",
        anyOf: [{ type: "window", count: 2, seconds: 5, condition: {
          type: "field", field: "sensor.temperature", operator: "range", min: 90, max: 100
        } }], inference: "Sensor remained hot", suggestedAction: "Check repeated readings", analysis: { suggestedActions: [] }
      }] } };
      const saved = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      });
      expect(saved.status).toBe(200);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(200);
      const uploaded = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "storage.log", contentType: "text/plain", skillId: skill.id,
        contentBase64: Buffer.from("2026-10-19T10:00:00Z INFO ready\n2026-10-19T10:00:01Z ERROR STORAGE_FULL temperature=95\n2026-10-19T10:00:02Z WARN temperature=96\n").toString("base64")
      });
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.log.skillRevision).toEqual({ id: saved.body.item.id, number: 2 });
      const edited = structuredClone(spec);
      edited.signalRules!.rules[0].anyOf = [{ type: "text", pattern: "NEVER_MATCH" }];
      edited.signalRules!.rules[0].inference = "Unpublished interpretation";
      edited.signalRules!.rules[1].anyOf = [{ type: "field", field: "sensor.temperature", operator: "range", min: 0, max: 10 }];
      edited.signalRules!.rules[2].anyOf = [{ type: "window", count: 10, seconds: 5, condition: { type: "text", pattern: "NEVER_MATCH" } }];
      const draft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: edited, baseDraftRevisionId: null, basePublishedRevisionId: saved.body.item.id
      });
      expect(draft.status).toBe(200);
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, maxAttempts: 1,
        analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } } })).toEqual({ status: "processed" });
      const response = await request<{ item: LogRecordDto }>(`/api/v1/logs/${uploaded.body.log.id}`);
      expect(response.status).toBe(200);
      const report = logRecordDtoSchema.parse(response.body.item);
      expect(report).toMatchObject({ status: "complete", analysisSource: "rules-fallback", degradedReason: "provider-unavailable",
        conclusion: "Legacy internal message", severity: "Critical", skillRevision: { id: saved.body.item.id, number: 2 } });
      expect(report.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleHit: "storage-full", filePath: "storage.log", lineNumbers: [2], inference: "Storage capacity exhausted" }),
        expect.objectContaining({ ruleHit: "temperature-high", filePath: "storage.log", lineNumbers: [2, 3], inference: "Sensor temperature requires review" }),
        expect.objectContaining({ ruleHit: "temperature-window", filePath: "storage.log", lineNumbers: [3], inference: "Sensor remained hot" })
      ]));
      expect(report.signalSummary?.signals).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "skill", kind: "skill:storage-full", anchors: [expect.objectContaining({ file: "storage.log", line: 2 })] }),
        expect.objectContaining({ source: "skill", kind: "skill:temperature-high", title: "Temperature high", severity: "Warning", count: 2 }),
        expect.objectContaining({ source: "skill", kind: "skill:temperature-window", title: "Repeated temperature", anchors: [expect.objectContaining({ file: "storage.log", line: 3 })] }),
        expect.objectContaining({ source: "generic", kind: "first-error" })
      ]));
      expect(JSON.stringify(report)).not.toContain("Unpublished interpretation");
      expect((await db.query("select skill_revision_id from log_analysis_runs where id=$1", [uploaded.body.job.runId])).rows)
        .toEqual([{ skill_revision_id: saved.body.item.id }]);
      expect((await db.query("select signal_summary from log_analysis_reports where run_id=$1", [uploaded.body.job.runId])).rows)
        .toEqual([{ signal_summary: report.signalSummary }]);
      const previewPath = `${base}/signals-preview`;
      const previewInput = { signalRules: spec.signalRules, parsing: spec.parsing };
      expect((await request(previewPath, "POST", previewInput)).status).toBe(400);
      const sample = (content: string) => request(`${base}/sample`, "PUT", {
        fileName: "storage.log", contentBase64: Buffer.from(content).toString("base64")
      });
      expect((await sample("INFO ready\nERROR STORAGE_FULL")).status).toBe(200);
      expect(await request(previewPath, "POST", previewInput)).toMatchObject({ status: 200, body: {
        valid: true, truncated: false, hits: [{ ruleId: "storage-full", lineNumber: 2, excerpt: "ERROR STORAGE_FULL" }]
      } });
      const invalid = structuredClone(spec.signalRules!);
      invalid.rules[0].anyOf = [{ type: "text", pattern: "[" }];
      expect(await request(previewPath, "POST", { signalRules: invalid, parsing: spec.parsing })).toMatchObject({ status: 200, body: {
        valid: false, issues: [expect.objectContaining({ path: ["signalRules", "rules", 0, "anyOf", 0, "pattern"] })]
      } });
      invalid.rules[0].anyOf = [{ type: "field", field: "missing.value", operator: "equals", value: "unknown" }];
      expect(await request(previewPath, "POST", { signalRules: invalid, parsing: spec.parsing })).toMatchObject({ status: 200, body: {
        valid: false, issues: [expect.objectContaining({ path: ["signalRules", "rules", 0, "anyOf", 0, "field"] })]
      } });
      expect((await sample(Array.from({ length: 501 }, () => "STORAGE_FULL").join("\n"))).status).toBe(200);
      const capped = await request<{ hits: unknown[]; truncated: boolean; reason?: string }>(previewPath, "POST", previewInput);
      expect(capped.status).toBe(200);
      expect(capped.body).toMatchObject({ valid: true, truncated: true, reason: "hit_cap" });
      expect(capped.body.hits).toHaveLength(500);
      expect((await sample(Array.from({ length: 5001 }, () => "ordinary").join("\n"))).status).toBe(200);
      expect(await request(previewPath, "POST", previewInput)).toMatchObject({ status: 200, body: {
        valid: true, hits: [], truncated: true, reason: expect.stringMatching(/^(line_cap|time_cap)$/)
      } });
      currentAuth = { ...auth, permissions: ["logs:view"] };
      expect((await request(previewPath, "POST", previewInput)).status).toBe(403);
      currentAuth = { ...authFor("signals-other"), permissions: [...auth.permissions] };
      expect((await request(previewPath, "POST", previewInput)).status).toBe(404);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("keeps the pinned charging diagnosis ahead of generic signals through rules, degradation and deterministic models", async () => {
    const ephemeral = await createEphemeralTestDatabase("chargingsignals");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth: ReturnType<typeof authFor> = { ...authFor(), permissions: [...authFor().permissions, "logs:admin-domains"] };
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Charging" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const invocation = createUserInvocation(auth), context = { requestId: "charging-signals" };
      const skill = await createLogSkill(db, auth, { name: "Seed charging", formatProfile: {} }, invocation, context);
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", signalRules: defaultChargingRuleSet }, null, skill.currentRevision.id, invocation, context);
      const published = await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
      const bytes = await readFile("test-fixtures/logs/charging-foldback.log");
      const adapters = [
        { analyzer: createRuleBasedLogAnalyzer(), confidence: 0.85 },
        { analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } }, confidence: 0.85 },
        { analyzer: createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(), modelLabel: "deterministic", maxSteps: 5, tokenBudget: 100_000 }), confidence: 0.82 },
        { analyzer: createLlmLogAnalyzer({ model: createDeterministicLogAnalysisModel(), modelLabel: "deterministic", tokenBudget: 100_000 }), confidence: 0.82 }
      ];
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      for (const { analyzer, confidence } of adapters) for (const skillId of [skill.id, undefined]) {
        const uploaded = await requestJson<{ log: { id: string }; job: { id: string } }>(createHttpServer(router), "/api/v1/log-files", {
          method: "POST", body: JSON.stringify({ fileName: "charging-foldback.log", contentType: "text/plain", skillId, contentBase64: bytes.toString("base64") })
        });
        expect(uploaded.status).toBe(201);
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, analyzer, maxAttempts: 1 })).toEqual({ status: "processed" });
        const response = await requestJson<{ item: unknown }>(createHttpServer(router), `/api/v1/logs/${uploaded.body.log.id}`);
        expect(response.status).toBe(200);
        const report = logRecordDtoSchema.parse(response.body.item);
        expect(report).toMatchObject({ status: "complete", confidence, skillRevision: skillId ? { id: published.currentRevision.id } : null });
        expect(report.conclusion).toMatch(/thermal foldback/i);
        expect(report.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: "charging-foldback.log", lineNumbers: expect.arrayContaining([4]), inference: expect.stringMatching(/thermal/i) })]));
        expect(report.signalSummary?.signals).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "first-error", source: "generic", anchors: [expect.objectContaining({ file: "charging-foldback.log", line: 4 })] })
        ]));
        if (skillId) expect(report.signalSummary?.signals).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "skill:thermal-foldback", source: "skill", anchors: expect.arrayContaining([expect.objectContaining({ file: "charging-foldback.log", line: 4 })]) })
        ]));
      }
      const emptySkill = await createLogSkill(db, auth, { name: "Explicit empty skill", formatProfile: {} }, invocation, context);
      const emptyUpload = await uploadLogFile(db, objectStore, auth, { fileName: "charging-foldback.log", contentType: "text/plain", bytes, logDomainId: emptySkill.id });
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: emptyUpload.job!.id })).toEqual({ status: "processed" });
      const emptyReport = await getLogRecord(db, auth, emptyUpload.log.id);
      expect(emptyReport.conclusion).toBe(genericSignalRuleSet.hitDefaults.conclusion);
      expect(emptyReport.confidence).toBe(0.55);
      expect(emptyReport.evidence.some((item) => item.ruleHit === "thermal-foldback")).toBe(false);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
  it("persists no-skill bundle signals, grounds their lines, and retains fallback and tenant boundaries", async () => {
    const ephemeral = await createEphemeralTestDatabase("logsignals");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    let auth = authFor();
    try {
      for (const id of ["signals-org", "signals-other"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }]
      });
      const zip = new JSZip();
      zip.file("kernel.log", "2026-10-19T10:00:00Z INFO Linux version 6.1\n2026-10-19T10:02:00Z kernel panic\n[ 12.0] Oops\n"
        + Array.from({ length: 8 }, (_, i) => `[ ${(12.1 + i * 0.05).toFixed(2)}] usb 1-1: error -71 while reading descriptor`).join("\n"));
      zip.file("app.log", Array.from({ length: 6 }, (_, index) => `2026-10-19T10:02:0${index}Z ERROR request id=${index} failed /tmp/request-${index}`).join("\n"));
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const uploaded = await requestJson<{ log: { id: string }; job: { id: string; runId: string } }>(createHttpServer(router), "/api/v1/log-files", {
        method: "POST", body: JSON.stringify({ fileName: "signals.zip", contentType: "application/zip",
          contentBase64: (await zip.generateAsync({ type: "nodebuffer" })).toString("base64") })
      });
      expect(uploaded.status).toBe(201);
      const final = { action: "final", conclusion: "Kernel crash and application error burst", impact: "Service disrupted", severity: "Critical", confidence: 0.8,
        suggestedActions: ["Inspect restart context"], evidence: [
          { filePath: "kernel.log", lineNumbers: [2], inference: "Kernel panic after a gap", suggestedAction: "Inspect kernel context" },
          { filePath: "app.log", lineNumbers: [1], inference: "Application errors", suggestedAction: "Inspect application context" }
        ] };
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "get_signals", args: {} } }, { content: final }
      ]);
      await expect(processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id,
        analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", maxSteps: 4, tokenBudget: 100_000 }) })).resolves.toEqual({ status: "processed" });
      const response = await requestJson<{ item: unknown }>(createHttpServer(router), `/api/v1/logs/${uploaded.body.log.id}`);
      expect(response.status).toBe(200);
      const report = logRecordDtoSchema.parse(response.body.item);
      expect(report).toMatchObject({ status: "complete", skillRevision: null, analysisSource: "agent", confidence: 0.8,
        evidence: [{ filePath: "kernel.log", lineNumbers: [2] }, { filePath: "app.log", lineNumbers: [1] }] });
      const summary = report.signalSummary!;
      expect(summary.signals.filter((signal) => signal.kind === "crash").map((signal) => signal.signature)).toEqual(["Kernel panic", "Oops"]);
      expect(summary.signals).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "error-burst", count: 8,
        anchors: expect.arrayContaining([expect.objectContaining({ file: "kernel.log", line: 4 })]) })]));
      expect(summary.signals.map((signal) => signal.kind)).toEqual(expect.arrayContaining(["crash", "timestamp-gap", "error-burst", "first-error"]));
      expect(summary.signals.every((signal) => signal.source === "generic" && signal.anchors.length > 0)).toBe(true);
      expect(summary.templates.some((template) => template.count >= 5 && template.first.file === "app.log" && template.last.line >= 5)).toBe(true);
      expect((await db.query("select signal_summary from log_analysis_reports where run_id=$1", [uploaded.body.job.runId])).rows)
        .toEqual([{ signal_summary: summary }]);
      auth = authFor("signals-other");
      expect((await requestJson(createHttpServer(router), `/api/v1/logs/${uploaded.body.log.id}`)).status).toBe(404);
      auth = authFor();
      // Exhausted provider retries use the same generic summary and preserve honest degradation.
      const fallback = await uploadLogFile(db, objectStore, auth, { fileName: "fallback.log", contentType: "text/plain", bytes: Buffer.from("kernel panic\nERROR unrelated fault") });
      await processLogAnalysisJobById({ db, objectStore, jobId: fallback.job!.id, maxAttempts: 1,
        analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } } });
      const degraded = await getLogRecord(db, auth, fallback.log.id);
      expect(degraded).toMatchObject({ status: "complete", analysisSource: "rules-fallback", degradedReason: "provider-unavailable" });
      expect(degraded.conclusion).toBe(genericSignalRuleSet.hitDefaults.conclusion);
      expect(degraded.confidence).toBeLessThanOrEqual(0.6);
      expect(degraded.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ ruleHit: "generic:crash", filePath: "fallback.log", lineNumbers: [1] })]));
      expect(degraded.evidence.some((item) => item.ruleHit === "thermal-foldback")).toBe(false);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
