import JSZip from "jszip";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { resolveRouteBodyLimit } from "../../app";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createDefaultKnowledgeTextExtractor } from "../knowledge/extraction";
import { createKnowledgeEntry, publishKnowledgeEntry } from "../knowledge/service";
import { createLogSkill, discardLogSkillDraft, publishLogSkill, saveLogSkillDraft } from "./skillsService";
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
      await expect(importLogSkillPackage(h.db, h.store, h.other, h.bytes, "draft", h.otherInvocation, h.context)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await h.counts()).toEqual(before);
      expect([...h.store.entries.keys()].sort()).toEqual(keys);
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
      const upload = async (bytes: Buffer, status?: string) => {
        const boundary = "wiseeff-package-boundary";
        const body = Buffer.concat([Buffer.from(`${status === undefined ? "" : `--${boundary}\r\nContent-Disposition: form-data; name="status"\r\n\r\n${status}\r\n`}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skill.zip"\r\nContent-Type: application/zip\r\n\r\n`),
          bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        return fetch(`${base}/api/v1/log-skills/import`, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
      };
      const invalid = await JSZip.loadAsync(h.bytes); invalid.remove("SKILL.md");
      const rejected = await upload(await invalid.generateAsync({ type: "nodebuffer" }));
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: { problems: ["SKILL.md: required file is missing"] } } });
      const badStatus = await upload(h.bytes, "invalid");
      expect(badStatus.status).toBe(400);
      const created = await upload(h.bytes);
      expect(created.status).toBe(201);
      const result = await created.json() as { item: Awaited<ReturnType<typeof importLogSkillPackage>> };
      expect(result.item).toMatchObject({ name: h.skill.name, draft: { status: "draft" } });
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
        .rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { problems: expect.arrayContaining(["SKILL.md: required file is missing"]) } });
      const invalid = await JSZip.loadAsync(h.bytes), rules = parseYaml(await invalid.file("signals.yaml")!.async("string"));
      rules.rules[0].anyOf[0].field = "charger.val.fields.UNKNOWN.meaning";
      invalid.file("signals.yaml", stringifyYaml(rules), { createFolders: false });
      await expect(importLogSkillPackage(h.db, h.store, h.other, await invalid.generateAsync({ type: "nodebuffer" }), "draft", h.otherInvocation, h.context))
        .rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { problems: expect.arrayContaining([
          expect.stringMatching(/^signals\.yaml: rules\[0\]\.anyOf\[0\]\.field: /)
        ]) } });
      const bomb = Buffer.from(h.bytes), central = bomb.readUInt32LE(bomb.length - 6);
      bomb.writeUInt32LE(0x7fffffff, central + 24);
      const traversal = await new JSZip().file("../SKILL.md", "escape", { createFolders: false }).generateAsync({ type: "nodebuffer" });
      const parse = vi.spyOn(JSZip, "loadAsync");
      try {
        for (const bytes of [bomb, traversal]) {
          await expect(importLogSkillPackage(h.db, h.store, h.other, bytes, "draft", h.otherInvocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
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
