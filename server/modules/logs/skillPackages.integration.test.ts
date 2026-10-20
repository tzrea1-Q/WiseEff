import JSZip from "jszip";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { resolveRouteBodyLimit } from "../../app";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createDefaultKnowledgeTextExtractor } from "../knowledge/extraction";
import { createKnowledgeEntry, publishKnowledgeEntry } from "../knowledge/service";
import { createLogSkill, discardLogSkillDraft, getLogSkill, publishLogSkill, saveLogSkillDraft } from "./skillsService";
import { provisionChargingSkill } from "./provisionChargingSkill";
import { updateLogDomainRow } from "./domainsRepository";
import { importSkillPackageArchive } from "./skillPackageArchive";
import { registerLogRoutes } from "./routes";
import { createAnalysisCase, readAnalysisCases } from "./analysisCases";
import { exportLogSkillPackage, importLogSkillPackage } from "./skillPackages";
import { genericSignalRuleSet } from "./analyzer";
import { LogAnalysisProviderError } from "./analyzer/llmAnalyzer";
import { processLogAnalysisJobById } from "./worker";
import { getLogRecord, uploadLogFile } from "./service";
import { runParseTests } from "./parseTests";
import type { LogSkillSpec } from "./skillSpec";

const available = await isTestDatabaseAvailable();
const content = "addr=0x0C val=0x00\naddr=0x0C val=0x20\naddr=0x0D val=0x20\n";
const spec: LogSkillSpec = { schemaVersion: "skill/v1", description: "Decode charging faults", procedure: "Inspect the register evidence, then check cooling.",
  stepBudget: 6, tokenBudget: 8000, parsing: { schemaVersion: "parsing/v1",
    registers: { REG0C: { width: 8, fields: [{ name: "CHRG_FAULT", bits: [5, 4], enum: { "0": "normal", "2": "thermal_shutdown" } }] } },
    registerMaps: { bq: { selectBy: "addr", cases: { "0x0C": "REG0C" } } },
    extractors: [{ id: "charger", pattern: "addr=(?P<addr>0x[0-9A-Fa-f]+) val=(?P<val>0x[0-9A-Fa-f]+)",
      fields: { addr: { type: "uint" }, val: { type: "hex", decode: { registerMap: "bq" } } } }] },
  signalRules: { ...genericSignalRuleSet, rules: [{ id: "thermal-shutdown", name: "BQ25890 thermal shutdown", severity: "Critical", stageId: "rootcause",
    anyOf: [{ type: "field", field: "charger.val.fields.CHRG_FAULT.meaning", operator: "equals", value: "thermal_shutdown" }],
    inference: "BQ25890 entered thermal shutdown", suggestedAction: "Inspect cooling", analysis: {
      conclusion: { value: "BQ25890 entered thermal shutdown", priority: 0 }, suggestedActions: []
    } }] },
  parseTests: [{ id: "thermal", name: "Decoded thermal fault", fileName: "charger.log", lines: ["addr=0x0C val=0x20"],
    expect: { fields: { "val.fields.CHRG_FAULT.meaning": "thermal_shutdown" }, signals: ["thermal-shutdown"], exactSignals: true } }] };

async function harness() {
  const ephemeral = await createEphemeralTestDatabase("skillpkg");
  const db = createPostgresDatabase(ephemeral.url), store = createMemoryObjectStore();
  const identities = ["package-a", "package-b"].map((organizationId) => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
    permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains", "knowledge:view", "knowledge:edit"] }));
  const [auth, other] = identities;
  for (const identity of identities) await seedCoreGraph(db, { organization: { id: identity.organization.id }, users: [{ id: identity.user.id }] });
  const invocation = createUserInvocation(auth), otherInvocation = createUserInvocation(other), context = { requestId: "skill-package-test" };
  const entry = await createKnowledgeEntry(db, store, createDefaultKnowledgeTextExtractor(), auth, {
    contentForm: "markdown", title: "Thermal register guidance", tags: ["charger"], contentMarkdown: "Thermal shutdown requires inspecting the cooling path."
  }, context);
  await publishKnowledgeEntry(db, auth, entry.id, context);
  const skill = await createLogSkill(db, auth, { name: "Portable BQ25890" }, invocation, context);
  const draft = await saveLogSkillDraft(db, auth, skill.id, { ...spec, knowledgeEntryIds: [entry.id] }, null, skill.currentRevision.id, invocation, context);
  await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
  await createAnalysisCase(db, store, auth, skill.id, { name: "Thermal register", expectations: {
    domain: "generic", summary: "Thermal shutdown", realLog: false, rootCauseCategory: "thermal-protection",
    rootCausePoints: ["BQ25890 entered thermal shutdown"], keyEvidenceLines: [2], expectedActions: ["Inspect cooling"], expectRefusal: false
  }, files: [{ fileName: "charger.log", bytes: Buffer.from(content) }] }, invocation, context);
  const bytes = await exportLogSkillPackage(db, store, auth, skill.id);
  const counts = async () => (await db.query(`select
    (select count(*)::int from log_domains where organization_id=$1) skills,
    (select count(*)::int from log_skill_revisions where organization_id=$1) revisions,
    (select count(*)::int from knowledge_entries where organization_id=$1) knowledge,
    (select count(*)::int from knowledge_revisions where organization_id=$1) knowledge_revisions,
    (select count(*)::int from log_skill_analysis_cases where organization_id=$1) cases,
    (select count(*)::int from log_file_objects where organization_id=$1) file_objects,
    (select count(*)::int from audit_events where organization_id=$1) audits`, [other.organization.id])).rows[0];
  return { db, store, auth, other, invocation, otherInvocation, context, skill, draft, entry, bytes, counts,
    async close() { await db.close(); await ephemeral.drop(); } };
}

describe.skipIf(!available)("skill packages over PostgreSQL", () => {
  it("round-trips seeded charging identity attributes and every portable revision section across organizations", async () => {
    const h = await harness();
    try {
      await provisionChargingSkill(h.db, h.auth.organization.id);
      const seeded = await getLogSkill(h.db, h.auth, `seed-charging:${h.auth.organization.id}`);
      expect(seeded.description).toBe("根据充电异常规则分析日志。");
      expect(seeded.currentRevision.spec).not.toHaveProperty("description");
      const original = await importLogSkillPackage(h.db, h.store, h.other,
        await exportLogSkillPackage(h.db, h.store, h.auth, seeded.id), "draft", h.otherInvocation, h.context);
      expect(original.description).toBe(seeded.description);
      expect(original.currentRevision.spec).toEqual({ ...seeded.currentRevision.spec,
        description: seeded.description, procedure: "", parseTests: [], knowledgeEntryIds: [] });

      // Legacy row-only settings must survive, without filling in deployment defaults.
      const rowProfile = { severityMap: { error: ["ERROR"], info: ["INFO"] } };
      await updateLogDomainRow(h.db, { organizationId: h.auth.organization.id, domainId: seeded.id,
        modelOverride: "legacy-model", formatProfile: rowProfile });
      const rowOnly = await importLogSkillPackage(h.db, h.store, h.other,
        await exportLogSkillPackage(h.db, h.store, h.auth, seeded.id), "draft", h.otherInvocation, h.context, undefined, "Legacy charging");
      expect(rowOnly).toMatchObject({ description: seeded.description, modelOverride: "legacy-model", formatProfile: rowProfile });
      expect(rowOnly.currentRevision.spec).toEqual({ ...original.currentRevision.spec, modelOverride: "legacy-model", formatProfile: rowProfile });
      expect(rowOnly.currentRevision.spec).not.toHaveProperty("stepBudget");
      expect(rowOnly.currentRevision.spec).not.toHaveProperty("tokenBudget");

      const draftProfile = { severityMap: { error: ["FAULT"], info: ["INFO"] } };
      const draft = await saveLogSkillDraft(h.db, h.auth, seeded.id, { ...seeded.currentRevision.spec,
        description: "", modelOverride: "draft-model", formatProfile: draftProfile,
        procedure: spec.procedure, parsing: spec.parsing,
        signalRules: { ...seeded.currentRevision.spec.signalRules!, rules: [...seeded.currentRevision.spec.signalRules!.rules, ...spec.signalRules!.rules] },
        parseTests: spec.parseTests, stepBudget: 4, tokenBudget: 6000, knowledgeEntryIds: [h.entry.id]
      }, null, seeded.currentRevision.id, h.invocation, h.context);
      const sourceCase = (await readAnalysisCases(h.db, h.auth.organization.id, h.skill.id))[0];
      await createAnalysisCase(h.db, h.store, h.auth, seeded.id, { name: sourceCase.name, expectations: sourceCase.expectations,
        files: [{ fileName: "charger.log", bytes: Buffer.from(content) }] }, h.invocation, h.context);
      const bytes = await exportLogSkillPackage(h.db, h.store, h.auth, seeded.id, "draft");
      const archived = await importSkillPackageArchive(bytes);
      expect(archived.spec.description).toBe(""); // An explicit empty description overrides the row.
      expect(archived.spec.modelOverride).toBe("draft-model");
      expect(archived.spec.formatProfile).toEqual(draftProfile);
      const imported = await importLogSkillPackage(h.db, h.store, h.other, bytes, "draft", h.otherInvocation, h.context, undefined, "Complete charging");
      const knowledgeIds = imported.currentRevision.spec.knowledgeEntryIds!;
      expect(knowledgeIds).toHaveLength(1);
      expect(knowledgeIds[0]).not.toBe(h.entry.id);
      expect(imported.currentRevision.spec).toEqual({ ...draft.spec, knowledgeEntryIds: knowledgeIds });
      expect(imported).toMatchObject({ description: draft.spec.description, modelOverride: draft.spec.modelOverride,
        formatProfile: draft.spec.formatProfile, webhook: { enabled: false, secretConfigured: false } });
      expect(imported.id).not.toBe(seeded.id);
      expect(imported.currentRevision.id).not.toBe(draft.id);
      expect((await h.db.query(`select e.status, r.title, r.tags, r.content_markdown from knowledge_entries e
        join knowledge_revisions r on r.id=e.head_revision_id and r.organization_id=e.organization_id
        where e.organization_id=$1 and e.id=$2`, [h.other.organization.id, knowledgeIds[0]])).rows)
        .toEqual([{ status: "draft", title: h.entry.title, tags: h.entry.tags, content_markdown: h.entry.contentMarkdown }]);
      const roundTrip = await importSkillPackageArchive(await exportLogSkillPackage(h.db, h.store, h.other, imported.id, "draft"));
      expect(roundTrip.cases).toEqual(archived.cases);
      expect(roundTrip.knowledge.map(({ path: _path, source: _source, ...entry }) => entry))
        .toEqual(archived.knowledge.map(({ path: _path, source: _source, ...entry }) => entry));
      expect(roundTrip.spec).not.toHaveProperty("defaultSourceSnapshotId");
    } finally { await h.close(); }
  }, 120_000);

  it("round-trips decoded rule evidence through real worker runs across organizations and links draft knowledge", async () => {
    const h = await harness();
    try {
      expect(await exportLogSkillPackage(h.db, h.store, h.auth, h.skill.id)).toEqual(h.bytes);
      const imported = await importLogSkillPackage(h.db, h.store, h.other, h.bytes, "published", h.otherInvocation, h.context);
      expect(imported.currentRevision.spec).toMatchObject(spec);
      expect(imported.currentRevision.status).toBe("published");
      expect(imported.currentRevision.spec.knowledgeEntryIds).toHaveLength(1);
      const importedKnowledgeId = imported.currentRevision.spec.knowledgeEntryIds![0];
      expect(importedKnowledgeId).not.toBe(h.entry.id);
      expect((await h.db.query(`select e.status, e.title, r.content_markdown from knowledge_entries e
        join knowledge_revisions r on r.id=e.head_revision_id and r.organization_id=e.organization_id
        where e.organization_id=$1 and e.id=$2`, [h.other.organization.id, importedKnowledgeId])).rows).toEqual([
        { status: "draft", title: h.entry.title, content_markdown: "Thermal shutdown requires inspecting the cooling path." }
      ]);
      expect(await runParseTests(imported.currentRevision.spec)).toMatchObject({ total: 1, passed: 1, failed: 0 });
      const originalCases = await readAnalysisCases(h.db, h.auth.organization.id, h.skill.id);
      const importedCases = await readAnalysisCases(h.db, h.other.organization.id, imported.id);
      expect(importedCases).toHaveLength(1);
      expect(importedCases[0].expectations).toMatchObject(originalCases[0].expectations);
      const reports = [];
      for (const [auth, skillId, item] of [[h.auth, h.skill.id, originalCases[0]], [h.other, imported.id, importedCases[0]]] as const) {
        const fixture = item.uploads.find((upload) => !item.expectations.bundleFiles || item.expectations.bundleFiles.includes(upload.fileName))!;
        const uploaded = await uploadLogFile(h.db, h.store, auth, { fileName: fixture.fileName.replace(/^fixtures\//, ""),
          contentType: "text/plain", bytes: await h.store.get(fixture.objectKey), logDomainId: skillId }, h.context);
        expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: uploaded.job!.id, maxAttempts: 1,
          analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } } })).toEqual({ status: "processed" });
        reports.push(await getLogRecord(h.db, auth, uploaded.log.id));
      }
      for (const report of reports) {
        expect(report).toMatchObject({ status: "complete", analysisSource: "rules-fallback", conclusion: "BQ25890 entered thermal shutdown" });
        expect(report.signalSummary?.signals.filter((signal) => signal.source === "skill")).toMatchObject([
          { kind: "skill:thermal-shutdown", count: 1, anchors: [{ file: "charger.log", line: 2 }] }
        ]);
        expect(report.evidence).toMatchObject([{ filePath: "charger.log", lineNumbers: [2], ruleHit: "thermal-shutdown",
          decodedFields: [{ extractor: "charger", line: 2, fields: { val: { fields: { CHRG_FAULT: { meaning: "thermal_shutdown" } } } } }] }]);
      }
      expect(reports[1].signalSummary).toEqual(reports[0].signalSummary);
      expect(reports[1].evidence.map(({ id: _id, ...evidence }) => evidence))
        .toEqual(reports[0].evidence.map(({ id: _id, ...evidence }) => evidence));
      expect((await h.db.query("select kind, actor_user_id from audit_events where organization_id=$1 and kind='log-skill-package-import'",
        [h.other.organization.id])).rows).toEqual([{ kind: "log-skill-package-import", actor_user_id: h.other.user.id }]);
    } finally { await h.close(); }
  }, 120_000);

  it("imports a single initial draft by default, exports the chosen revision and applies the existing name collision rule", async () => {
    const h = await harness();
    try {
      const imported = await importLogSkillPackage(h.db, h.store, h.other, h.bytes, undefined, h.otherInvocation, h.context);
      expect(imported.draft).toMatchObject({ status: "draft", number: 1 });
      expect((await h.db.query("select status, revision_number from log_skill_revisions where organization_id=$1 and skill_id=$2",
        [h.other.organization.id, imported.id])).rows).toEqual([{ status: "draft", revision_number: 1 }]);
      await expect(exportLogSkillPackage(h.db, h.store, h.other, imported.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await JSZip.loadAsync(await exportLogSkillPackage(h.db, h.store, h.other, imported.id, "draft"))).file("SKILL.md")).not.toBeNull();
      await expect(discardLogSkillDraft(h.db, h.other, imported.id, imported.draft!.id, h.otherInvocation, h.context))
        .rejects.toMatchObject({ code: "CONFLICT" });
      const saved = await saveLogSkillDraft(h.db, h.other, imported.id, { ...imported.draft!.spec, procedure: "Initial draft updated." },
        imported.draft!.id, imported.currentRevision.id, h.otherInvocation, h.context);
      expect(saved).toMatchObject({ status: "draft", spec: { procedure: "Initial draft updated." } });
      const published = await publishLogSkill(h.db, h.other, imported.id, saved.id, h.otherInvocation, h.context);
      expect(published).toMatchObject({ draft: null, currentRevision: { id: saved.id, status: "published" } });
      const draft = await saveLogSkillDraft(h.db, h.auth, h.skill.id, { ...h.draft.spec, procedure: "Draft-only procedure." }, null,
        h.draft.id, h.invocation, h.context);
      expect(draft.status).toBe("draft");
      const publishedZip = await JSZip.loadAsync(await exportLogSkillPackage(h.db, h.store, h.auth, h.skill.id));
      const draftZip = await JSZip.loadAsync(await exportLogSkillPackage(h.db, h.store, h.auth, h.skill.id, "draft"));
      expect(await publishedZip.file("SKILL.md")!.async("string")).toContain(spec.procedure);
      expect(await draftZip.file("SKILL.md")!.async("string")).toContain("Draft-only procedure.");
      const before = await h.counts(), keys = [...h.store.entries.keys()].sort();
      await expect(importLogSkillPackage(h.db, h.store, h.other, h.bytes, "draft", h.otherInvocation, h.context)).rejects.toMatchObject({
        code: "CONFLICT", details: { fieldErrors: { name: expect.any(String) }, nameSuggestion: `${h.skill.name}（导入）`, packageName: h.skill.name }
      });
      expect(await h.counts()).toEqual(before);
      expect([...h.store.entries.keys()].sort()).toEqual(keys);
      await expect(importLogSkillPackage(h.db, h.store, h.other, h.bytes, "draft", h.otherInvocation, h.context, undefined, "x".repeat(121)))
        .rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fieldErrors: { name: expect.any(String) } } });
      expect(await h.counts()).toEqual(before);
      const reimported = await importLogSkillPackage(h.db, h.store, h.auth, h.bytes, "draft", h.invocation, h.context, undefined, `  ${h.skill.name}（导入）  `);
      expect(reimported).toMatchObject({ name: `${h.skill.name}（导入）`, draft: { status: "draft" } });
    } finally { await h.close(); }
  }, 120_000);

  it("rejects initial drafts through every upload selector until publication while retaining admin visibility", async () => {
    const h = await harness();
    try {
      const imported = await importLogSkillPackage(h.db, h.store, h.other, h.bytes, undefined, h.otherInvocation, h.context);
      const router = createRouter();
      registerLogRoutes(router, { db: h.db, objectStore: h.store, getCurrentAuthContext: () => h.other });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const list = await request<{ items: { id: string; currentRevision: { publishedAt: string | null } }[] }>("/api/v1/log-skills");
      expect(list.body.items).toEqual(expect.arrayContaining([expect.objectContaining({
        id: imported.id, currentRevision: expect.objectContaining({ publishedAt: null })
      })]));
      const uploadBody = { fileName: "charger.log", contentType: "text/plain", contentBase64: Buffer.from(content).toString("base64") };
      const generic = await request<{ fileObject: { id: string } }>("/api/v1/log-files", "POST", uploadBody);
      expect(generic.status).toBe(201);
      for (const selection of [{ skillId: imported.id }, { logDomainId: imported.id }, { skillKey: imported.skillKey }]) {
        for (const [path, body] of [["/api/v1/log-files", uploadBody],
          ["/api/v1/logs", { fileObjectId: generic.body.fileObject.id, fileName: "charger.log" }]] as const) {
          const result = await request(path, "POST", { ...body, ...selection });
          expect(result.status).toBe(409);
          expect(result.body).toMatchObject({ error: { code: "CONFLICT", message: "此分析技能尚未发布。" } });
        }
      }
      await publishLogSkill(h.db, h.other, imported.id, imported.draft!.id, h.otherInvocation, h.context);
      const published = await request<{ items: { id: string; currentRevision: { publishedAt: string | null } }[] }>("/api/v1/log-skills");
      expect(published.body.items.find((item) => item.id === imported.id)?.currentRevision.publishedAt).toEqual(expect.any(String));
      expect((await request("/api/v1/log-files", "POST", { ...uploadBody, skillId: imported.id })).status).toBe(201);
    } finally { await h.close(); }
  }, 120_000);

  it("serves ZIP exports and validates multipart imports through the HTTP transport", async () => {
    const h = await harness();
    let auth = h.auth;
    const router = createRouter();
    registerLogRoutes(router, { db: h.db, objectStore: h.store, getCurrentAuthContext: () => auth });
    const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Package test server did not bind a TCP port.");
      const base = `http://127.0.0.1:${address.port}`;
      const exported = await fetch(`${base}/api/v1/log-skills/${h.skill.id}/package`);
      expect(exported.status).toBe(200);
      expect(exported.headers.get("content-type")).toBe("application/zip");
      expect(exported.headers.get("content-disposition")).toContain("skill-package.zip");
      expect(Buffer.from(await exported.arrayBuffer())).toEqual(h.bytes);
      auth = h.other;
      const upload = async (bytes: Buffer, status?: string, name?: string) => {
        const boundary = "wiseeff-package-boundary";
        const fields = Object.entries({ status, name }).filter(([, value]) => value !== undefined)
          .map(([field, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`).join("");
        const body = Buffer.concat([Buffer.from(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skill.zip"\r\nContent-Type: application/zip\r\n\r\n`),
          bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        return fetch(`${base}/api/v1/log-skills/import`, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
      };
      const invalid = await JSZip.loadAsync(h.bytes); invalid.remove("SKILL.md");
      const rejected = await upload(await invalid.generateAsync({ type: "nodebuffer" }));
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { issues: [{ path: "SKILL.md", message: "缺少必需文件" }] } } });
      const broken = await JSZip.loadAsync(h.bytes);
      broken.remove("SKILL.md"); broken.file("signals.yaml", "rules: [\n");
      const allIssues = await upload(await broken.generateAsync({ type: "nodebuffer" }));
      expect(allIssues.status).toBe(400);
      expect(await allIssues.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { issues: expect.arrayContaining([
        { path: "SKILL.md", message: "缺少必需文件" }, expect.objectContaining({ path: "signals.yaml", message: expect.any(String) })
      ]) } } });
      const manyKeys = await JSZip.loadAsync(h.bytes);
      manyKeys.file("parsing.yaml", Array.from({ length: 50_000 }, (_, i) => `k${i}: 0`).join("\n"));
      const manyKeyBytes = await manyKeys.generateAsync({ type: "nodebuffer" });
      const started = performance.now(), bounded = await upload(manyKeyBytes);
      expect(bounded.status).toBe(400);
      expect(await bounded.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { issues: expect.arrayContaining([
        expect.objectContaining({ path: "parsing.yaml", message: expect.any(String) })
      ]) } } });
      expect(performance.now() - started).toBeLessThan(1000);
      expect(await h.counts()).toEqual({ skills: 0, revisions: 0, knowledge: 0, knowledge_revisions: 0, cases: 0, file_objects: 0, audits: 0 });
      const badStatus = await upload(h.bytes, "invalid");
      expect(badStatus.status).toBe(400);
      const badName = await upload(h.bytes, undefined, "x".repeat(121));
      expect(badName.status).toBe(400);
      expect(await badName.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { fieldErrors: { name: expect.any(String) } } } });
      const created = await upload(h.bytes, undefined, "   ");
      expect(created.status).toBe(201);
      const result = await created.json() as { item: Awaited<ReturnType<typeof importLogSkillPackage>> };
      expect(result.item).toMatchObject({ name: h.skill.name, draft: { status: "draft" } });
      const collision = await upload(h.bytes);
      expect(collision.status).toBe(409);
      expect(await collision.json()).toMatchObject({ error: { code: "CONFLICT", details: {
        fieldErrors: { name: expect.any(String) }, nameSuggestion: `${h.skill.name}（导入）`, packageName: h.skill.name
      } } });
      const renamed = await upload(h.bytes, "published", `  ${h.skill.name}（导入）  `);
      expect(renamed.status).toBe(201);
      expect(await renamed.json()).toMatchObject({ item: { name: `${h.skill.name}（导入）`, currentRevision: { status: "published" } } });
      const draftExport = await fetch(`${base}/api/v1/log-skills/${result.item.id}/package?revision=draft`);
      expect(draftExport.status).toBe(200);
      expect((await JSZip.loadAsync(await draftExport.arrayBuffer())).file("SKILL.md")).not.toBeNull();
      const invalidRevision = await fetch(`${base}/api/v1/log-skills/${result.item.id}/package?revision=invalid`);
      expect(invalidRevision.status).toBe(400);
      const foreign = await fetch(`${base}/api/v1/log-skills/${h.skill.id}/package`);
      expect(foreign.status).toBe(404);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await h.close();
    }
  }, 120_000);

  it("retains the published-revision invariant after publication and forbids deleting the only initial draft", async () => {
    const h = await harness();
    try {
      await saveLogSkillDraft(h.db, h.auth, h.skill.id, { ...h.draft.spec, procedure: "Pending changes." }, null,
        h.draft.id, h.invocation, h.context);
      await expect(h.db.transaction(async (tx) => {
        await tx.query("update log_skill_revisions set status='superseded' where organization_id=$1 and skill_id=$2 and status='published'",
          [h.auth.organization.id, h.skill.id]);
      })).rejects.toThrow("A skill requires a published revision or an initial draft");
      expect((await h.db.query("select status from log_skill_revisions where organization_id=$1 and id=$2",
        [h.auth.organization.id, h.draft.id])).rows).toEqual([{ status: "published" }]);
      const imported = await importLogSkillPackage(h.db, h.store, h.other, h.bytes, "draft", h.otherInvocation, h.context);
      await expect(h.db.transaction(async (tx) => {
        await tx.query("delete from log_skill_revisions where organization_id=$1 and skill_id=$2", [h.other.organization.id, imported.id]);
      })).rejects.toThrow("A skill requires a published revision or an initial draft");
      expect((await h.db.query("select status from log_skill_revisions where organization_id=$1 and skill_id=$2",
        [h.other.organization.id, imported.id])).rows).toEqual([{ status: "draft" }]);
    } finally { await h.close(); }
  }, 120_000);

  it("allows an admin without logs:view to import a package with no linked knowledge", async () => {
    const h = await harness();
    try {
      const zip = await JSZip.loadAsync(h.bytes);
      for (const path of Object.keys(zip.files)) if (path.startsWith("knowledge/")) zip.remove(path);
      const admin = { ...h.other, permissions: h.other.permissions.filter((permission) => permission === "logs:admin-domains") };
      const imported = await importLogSkillPackage(h.db, h.store, admin, await zip.generateAsync({ type: "nodebuffer" }), undefined,
        createUserInvocation(admin), h.context);
      expect(imported).toMatchObject({ name: h.skill.name, draft: { status: "draft", spec: { knowledgeEntryIds: [] } } });
      expect(await readAnalysisCases(h.db, h.other.organization.id, imported.id)).toHaveLength(1);
      expect((await h.db.query("select id from knowledge_entries where organization_id=$1", [h.other.organization.id])).rows).toEqual([]);
    } finally { await h.close(); }
  }, 120_000);

  it("reports exact invalid file paths and rejects bombs and traversal before ZIP parsing without writing any rows", async () => {
    const h = await harness();
    try {
      const before = await h.counts(), keys = [...h.store.entries.keys()].sort();
      expect(before).toEqual({ skills: 0, revisions: 0, knowledge: 0, knowledge_revisions: 0, cases: 0, file_objects: 0, audits: 0 });
      const missing = await JSZip.loadAsync(h.bytes); missing.remove("SKILL.md");
      await expect(importLogSkillPackage(h.db, h.store, h.other, await missing.generateAsync({ type: "nodebuffer" }), "draft", h.otherInvocation, h.context))
        .rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { problems: expect.arrayContaining(["SKILL.md: 缺少必需文件"]) } });
      const invalid = await JSZip.loadAsync(h.bytes), rules = parseYaml(await invalid.file("signals.yaml")!.async("string"));
      rules.rules[0].anyOf[0].field = "charger.val.fields.UNKNOWN.meaning";
      invalid.file("signals.yaml", stringifyYaml(rules), { createFolders: false });
      await expect(importLogSkillPackage(h.db, h.store, h.other, await invalid.generateAsync({ type: "nodebuffer" }), "draft", h.otherInvocation, h.context))
        .rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { problems: expect.arrayContaining([
          expect.stringMatching(/^signals\.yaml: rules\[0\]\.anyOf\[0\]\.field: /)
        ]) } });
      const budget = await JSZip.loadAsync(h.bytes);
      budget.file("SKILL.md", (await budget.file("SKILL.md")!.async("string")).replace("stepBudget: 6", "stepBudget: 7"));
      await expect(importLogSkillPackage(h.db, h.store, h.other, await budget.generateAsync({ type: "nodebuffer" }), "draft", h.otherInvocation, h.context))
        .rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { packageName: h.skill.name,
          issues: [{ path: "SKILL.md › stepBudget", message: "不能超过平台上限（6）。" }] } });
      const bomb = Buffer.from(h.bytes), central = bomb.readUInt32LE(bomb.length - 6);
      bomb.writeUInt32LE(0x7fffffff, central + 24);
      const traversal = await new JSZip().file("../SKILL.md", "escape", { createFolders: false }).generateAsync({ type: "nodebuffer" });
      const parse = vi.spyOn(JSZip, "loadAsync");
      try {
        for (const bytes of [bomb, traversal]) {
          await expect(importLogSkillPackage(h.db, h.store, h.other, bytes, "draft", h.otherInvocation, h.context)).rejects.toMatchObject({
            code: "VALIDATION_FAILED", details: { issues: [expect.objectContaining({ message: expect.stringMatching(/[\u3400-\u9fff]/) })] }
          });
        }
        expect(parse).not.toHaveBeenCalled();
      } finally { parse.mockRestore(); }
      expect(await h.counts()).toEqual(before);
      expect([...h.store.entries.keys()].sort()).toEqual(keys);
    } finally { await h.close(); }
  }, 120_000);

  it("rolls back skills, revisions, knowledge, cases and fixture objects if the import audit fails", async () => {
    const h = await harness();
    try {
      const before = await h.counts(), keys = [...h.store.entries.keys()].sort();
      await h.db.query(`create function reject_skill_package_audit() returns trigger language plpgsql as $$ begin
        if new.kind='log-skill-package-import' then raise exception 'package audit unavailable'; end if; return new; end $$;
        create trigger reject_skill_package_audit before insert on audit_events for each row execute function reject_skill_package_audit()`);
      await expect(importLogSkillPackage(h.db, h.store, h.other, h.bytes, "published", h.otherInvocation, h.context)).rejects.toThrow("package audit unavailable");
      expect(await h.counts()).toEqual(before);
      expect([...h.store.entries.keys()].sort()).toEqual(keys);
    } finally { await h.close(); }
  }, 120_000);

  it("requires an authorized human principal and isolates package exports by organization", async () => {
    const h = await harness();
    try {
      const before = await h.counts(), keys = [...h.store.entries.keys()].sort();
      const denied = { ...h.other, permissions: h.other.permissions.filter((permission) => permission !== "logs:admin-domains") };
      await expect(importLogSkillPackage(h.db, h.store, denied, h.bytes, "draft", createUserInvocation(denied), h.context)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(exportLogSkillPackage(h.db, h.store, denied, h.skill.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(exportLogSkillPackage(h.db, h.store, h.other, h.skill.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const mismatched = { ...h.other, user: { ...h.other.user, organizationId: h.auth.organization.id } };
      await expect(importLogSkillPackage(h.db, h.store, mismatched, h.bytes, "draft", h.otherInvocation, h.context)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(importLogSkillPackage(h.db, h.store, h.other, h.bytes, "draft", h.invocation, h.context)).rejects.toThrow("invocation principal does not match");
      const agent = createAgentInvocation(h.other, { sessionId: "package-agent", toolCallId: "package-import", approval: { required: true, approvalId: "approved" } });
      await expect(importLogSkillPackage(h.db, h.store, h.other, h.bytes, "draft", agent, h.context)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const noKnowledgeEdit = { ...h.other, permissions: h.other.permissions.filter((permission) => permission !== "knowledge:edit") };
      await expect(importLogSkillPackage(h.db, h.store, noKnowledgeEdit, h.bytes, "draft", createUserInvocation(noKnowledgeEdit), h.context)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const noKnowledgeView = { ...h.auth, permissions: h.auth.permissions.filter((permission) => permission !== "knowledge:view") };
      await expect(exportLogSkillPackage(h.db, h.store, noKnowledgeView, h.skill.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await h.counts()).toEqual(before);
      expect([...h.store.entries.keys()].sort()).toEqual(keys);
    } finally { await h.close(); }
  }, 120_000);
});
