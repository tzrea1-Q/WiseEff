import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient, WiseEffApiError } from "./apiClient";
import { createHttpLogAnalysisRepository } from "./logClient";
import type { LogJobDto, LogRecordDto } from "./logDtos";
import { mockSkillWorkspace, mockSkillSample, mockSkillTemplates } from "@/infrastructure/mock/logSkills";

const baseLogDto: LogRecordDto = {
  id: "log-1",
  reportId: "report-1",
  fileName: "pack-controller.log",
  source: "upload",
  fileSizeBytes: 1_048_576,
  status: "complete",
  archiveState: "active",
  stage: "report",
  confidence: 0.91,
  conclusion: "Charge current derated after thermal warning.",
  impact: "Fast charge throughput reduced.",
  evidence: [
    {
      id: "ev-1",
      stageId: "pattern",
      lineNumbers: [1],
      inference: "Thermal warnings cluster before derating.",
      suggestedAction: "Check pack coolant loop."
    }
  ],
  suggestedActions: ["Inspect coolant loop"],
  severity: "Warning",
  rawLines: ["1 WARN temp=74"],
  capturedAt: "2026-05-25T02:00:00.000Z",
  updatedAt: "2026-05-25T02:05:00.000Z",
  submittedBy: "Xu Yun"
};

const baseJobDto: LogJobDto = {
  id: "job-1",
  kind: "log-analysis",
  logId: "log-1",
  runId: "run-1",
  status: "processing",
  progress: 45,
  currentStage: "pattern",
  error: null,
  updatedAt: "2026-05-25T02:06:00.000Z"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createFetchMock(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => jsonResponse(body, status));
}

function createRepository(fetchMock: typeof fetch) {
  return createHttpLogAnalysisRepository({
    apiClient: createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock }),
    baseUrl: "http://127.0.0.1:8787"
  });
}

it("submits the exact confirmed version and reads durable deletion receipts through validated envelopes", async () => {
  const item = { logId: "log/1", version: "a".repeat(64), database: "deleted", objects: "pending", pendingObjects: 1 };
  const fetchMock = createFetchMock({ item }), repository = createRepository(fetchMock);
  await expect(repository.purgeLog!(item.logId, item.version)).resolves.toEqual(item);
  expect(fetchMock).toHaveBeenLastCalledWith("http://127.0.0.1:8787/api/v1/logs/log%2F1", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ version: item.version }) }));
  await expect(repository.getLogDeletionStatus!(item.logId)).resolves.toEqual(item);
  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [item] }));
  await expect(repository.pendingLogDeletions!()).resolves.toEqual([item]);
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...item, objects: "unknown" } }));
  await expect(repository.getLogDeletionStatus!(item.logId)).rejects.toThrow();
});

it("reads a deletion preview through the protected record route and rejects an invalid snapshot", async () => {
  const item = { organizationId: "org", logId: "log/1", fileName: "owned.log", generatedAt: "2026-10-20T12:00:00.000Z",
    version: "a".repeat(64), inventory: [], objects: { total: 0, shared: 0, exclusive: 0 }, conditions: [], notes: [] };
  const fetchMock = createFetchMock({ item });
  const repository = createRepository(fetchMock);
  await expect(repository.previewLogDeletion!("log/1")).resolves.toEqual(item);
  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/logs/log%2F1/deletion-preview", expect.objectContaining({ method: "GET" }));
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...item, version: "invalid" } }));
  await expect(repository.previewLogDeletion!("log/1")).rejects.toThrow();
});

it.each([undefined, "  ", "  充电（导入）  "])("uploads skill packages with an optional trimmed name (%s)", async (name) => {
  const skill = mockSkillWorkspace("skill-charging")!;
  const fetchMock = createFetchMock({ item: skill });
  const file = new File(["zip"], "skill.zip", { type: "application/zip" });
  await expect(createRepository(fetchMock).importSkillPackage!(file, "draft", name)).resolves.toEqual(skill);
  expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/log-skills/import", expect.objectContaining({ method: "POST" }));
  const form = fetchMock.mock.calls[0][1]!.body as FormData;
  expect(form.get("status")).toBe("draft");
  expect(form.get("name")).toBe(name?.trim() || null);
  expect(form.get("file")).toBe(file);
});

it("validates extractor and format preview responses through encoded skill endpoints", async () => {
  const extractor = { pattern: "^n=(?P<n>\\d+)$", fields: { n: { type: "uint" } }, matchedLines: [{ line: 1, text: "n=2" }], matchCount: 1, totalLines: 1, coverage: 1 };
  const format = { lines: [{ line: 1, text: "INFO ready", severity: "info" }], entries: [{ lineNumbers: [1], text: "INFO ready", severity: "info" }] };
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(extractor)).mockResolvedValueOnce(jsonResponse(format));
  const repository = createRepository(fetchMock);
  const extractorInput = { line: "n=1", segments: [{ start: 2, end: 3, name: "n", type: "uint" as const }], sampleLines: ["n=2"] };
  await expect(repository.generateExtractorPattern!("skill/a", extractorInput)).resolves.toEqual(extractor);
  await expect(repository.previewFormat!("skill/a", { sampleText: "INFO ready", formatProfile: {} })).resolves.toEqual(format);
  expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-skills/skill%2Fa/extractor-preview");
  expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8787/api/v1/log-skills/skill%2Fa/format-preview");
});

it("requests a bounded line range with encoded record and file identity", async () => {
  const item = { file: "device/a b.log", startLine: 2, endLine: 3, totalLines: 3,
    lines: [{ lineNumber: 2, content: "second" }, { lineNumber: 3, content: "last" }] };
  const fetchMock = createFetchMock({ item });
  await expect(createRepository(fetchMock).getLogLines!("record/id", item.file, 2, 100)).resolves.toEqual(item);
  const url = new URL(String(fetchMock.mock.calls[0][0]));
  expect(url.pathname).toBe("/api/v1/logs/record%2Fid/lines");
  expect(Object.fromEntries(url.searchParams)).toEqual({ file: item.file, startLine: "2", endLine: "100" });
});

it("uses template, creation and sample contracts with encoded skill ids", async () => {
  const skill = mockSkillWorkspace("skill-charging")!;
  const fetchMock = createFetchMock({ items: mockSkillTemplates });
  const repository = createRepository(fetchMock);
  await expect(repository.listSkillTemplates!()).resolves.toEqual(mockSkillTemplates);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/log-skill-templates");
  const input = { name: "New", startingPoint: { templateId: "linux-dmesg" } };
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: skill }));
  await expect(repository.createLogSkill!(input)).resolves.toEqual(skill);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/log-skills");
  expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual(input);
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: mockSkillSample }));
  await expect(repository.getSkillSample!("skill/a")).resolves.toEqual(mockSkillSample);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/log-skills/skill%2Fa/sample");
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: null }));
  await expect(repository.getSkillSample!(skill.id)).resolves.toBeNull();
  const { content: _content, truncated: _truncated, ...metadata } = mockSkillSample;
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: metadata }));
  const file = new File(["hello"], "sample.log");
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("hello").buffer });
  await repository.replaceSkillSample!("skill/a", file);
  expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("PUT");
  expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ fileName: "sample.log", contentBase64: "aGVsbG8=" });
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await repository.deleteSkillSample!("skill/a");
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/log-skills/skill%2Fa/sample");
  expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
});

it("uses workspace contracts, encodes ids and sends draft bases for all authoring requests", async () => {
  const skill = mockSkillWorkspace("skill-charging")!;
  const draft = { ...skill.currentRevision, id: "draft", status: "draft" as const };
  const fetchMock = createFetchMock({ item: skill });
  const repository = createRepository(fetchMock);
  await expect(repository.getLogSkill!("skill/a")).resolves.toEqual(skill);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/log-skills/skill%2Fa");
  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [draft] }));
  await expect(repository.listSkillRevisions!(skill.id)).resolves.toEqual([draft]);
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: draft }));
  await repository.saveSkillDraft!(skill.id, draft.spec, "base", skill.currentRevision.id);
  expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ spec: draft.spec, baseDraftRevisionId: "base", basePublishedRevisionId: skill.currentRevision.id });
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: draft }));
  await repository.saveSkillDraft!(skill.id, draft.spec, null, skill.currentRevision.id);
  expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).baseDraftRevisionId).toBeNull();
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(repository.discardSkillDraft!(skill.id, "draft/a?b")).resolves.toBeUndefined();
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("http://127.0.0.1:8787/api/v1/log-skills/skill-charging/draft?draftRevisionId=draft%2Fa%3Fb");
  expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: skill }));
  await repository.publishSkill!(skill.id, "draft");
  expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ draftRevisionId: "draft" });
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: skill }));
  await expect(repository.restoreSkillRevision!(skill.id, "old/id")).resolves.toEqual(skill);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/revisions/old%2Fid/restore");
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "LOG_SKILL_DRAFT_CONFLICT" } }, 409));
  await expect(repository.saveSkillDraft!(skill.id, draft.spec, null, skill.currentRevision.id)).rejects.toMatchObject({ code: "LOG_SKILL_DRAFT_CONFLICT" });
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "LOG_SKILL_DRAFT_CONFLICT" } }, 409));
  await expect(repository.discardSkillDraft!(skill.id, "draft")).rejects.toMatchObject({ code: "LOG_SKILL_DRAFT_CONFLICT" });
});

it("runs unsaved parse tests through the bounded server contract with an encoded skill id", async () => {
  const run = { total: 1, passed: 0, failed: 1, truncated: false, results: [{ id: "test", name: "Sample", passed: false,
    diffs: [{ path: "value", expected: 2, actual: null, missing: true }], missingSignals: [], unexpectedSignals: [], events: [], signals: [] }] };
  const fetchMock = createFetchMock(run);
  const spec = { schemaVersion: "skill/v1" as const, parseTests: [{ id: "test", name: "Sample", lines: ["value=1"], expect: { fields: { value: 2 } } }] };
  await expect(createRepository(fetchMock).runSkillParseTests!("skill/a", spec)).resolves.toEqual(run);
  expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-skills/skill%2Fa/parse-tests");
  expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ spec });
});

it("uses source snapshot DTOs, multipart archives, and encoded skill/snapshot paths", async () => {
  const skill = mockSkillWorkspace("skill-charging")!;
  const snapshot = { id: "snapshot-1", skillId: skill.id, versionLabel: "v1", status: "queued", filesProcessed: 0, filesTotal: 0,
    fileCount: 0, skippedCount: 0, skippedFiles: [], error: null, createdAt: "2026-10-19T00:00:00.000Z" };
  const fetchMock = createFetchMock({ items: [snapshot] });
  const repository = createRepository(fetchMock);
  await expect(repository.listSourceSnapshots!("skill/a")).resolves.toEqual([snapshot]);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/log-skills/skill%2Fa/source-snapshots");
  const file = new File(["compressed source"], "source.tgz", { type: "application/gzip" });
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: snapshot }, 201));
  await expect(repository.uploadSourceSnapshot!("skill/a", { versionLabel: "v1", file })).resolves.toEqual(snapshot);
  const request = fetchMock.mock.calls.at(-1)![1]!;
  expect(request.method).toBe("POST");
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).get("file")).toBe(file);
  expect((request.body as FormData).get("versionLabel")).toBe("v1");
  expect(request.headers).not.toHaveProperty("Content-Type");
  const draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec, defaultSourceSnapshotId: snapshot.id } };
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...skill, draft } }));
  await expect(repository.setDefaultSourceSnapshot!("skill/a", "snap/b")).resolves.toMatchObject({ draft: { spec: { defaultSourceSnapshotId: snapshot.id } } });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/skill%2Fa/source-snapshots/snap%2Fb/default");
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...snapshot, status: "archived" } }));
  await expect(repository.archiveSourceSnapshot!("skill/a", "snap/b")).resolves.toMatchObject({ status: "archived" });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/skill%2Fa/source-snapshots/snap%2Fb/archive");
  const excerpt = { snapshotId: "snap/b", path: "drivers/thermal.c", line: 9, versionLabel: "v1", startLine: 6, excerpt: "pr_warn(\"thermal foldback\");" };
  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ ...excerpt, confidence: 0.95 }], truncated: false }));
  await expect(repository.locateSourceStatement!("skill/a", "snap/b", "thermal foldback")).resolves.toMatchObject({ items: [{ path: "drivers/thermal.c", line: 9 }] });
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/skill%2Fa/source-snapshots/snap%2Fb/locate");
  expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toEqual({ line: "thermal foldback" });
  fetchMock.mockResolvedValueOnce(jsonResponse({ item: excerpt }));
  await expect(repository.getSourceEvidence!("log/a", "evidence/b")).resolves.toEqual(excerpt);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/logs/log%2Fa/evidence/evidence%2Fb/source");
  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ ...snapshot, status: "unexpected" }] }));
  await expect(repository.listSourceSnapshots!(skill.id)).rejects.toMatchObject({ code: "INTERNAL_ERROR", details: { reason: "contract-drift" } });
});

describe("createHttpLogAnalysisRepository", () => {
  it("gets the real kernel report with string raw values and decoded evidence", async () => {
    const evidence = [{
      decodedFields: [{ v: 1, file: "kernel.log", line: 1, fields: {
        ibus: { raw: "1450", value: 1450 }, temp: { raw: "71", value: 71 }, vbus: { raw: "9012", value: 9012 }
      }, source: "declarative", extractor: "thermal" }],
      id: "evidence-…-0", stageId: "rootcause", lineNumbers: [1, 3, 4],
      inference: "Thermal protection reduced charging output.", suggestedAction: "…", filePath: "kernel.log", ruleHit: "thermal-foldback"
    }];
    const fetchMock = createFetchMock({ item: { ...baseLogDto, fileName: "kernel.log", evidence } });
    const repository = createRepository(fetchMock);
    expect((await repository.getLog("log-1"))?.evidence).toEqual(evidence);

    const multilineEvidence = [{ ...evidence[0], decodedFields: [{ ...evidence[0].decodedFields[0], endLine: 4,
      errors: [{ field: "temp", code: "conversion", message: "Invalid temperature" }] }] }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...baseLogDto, evidence: multilineEvidence } }));
    expect((await repository.getLog("log-1"))?.evidence).toEqual(multilineEvidence);
  });

  it("previews unsaved parsing and preserves decoded evidence across the HTTP port", async () => {
    const preview = { valid: true, truncated: false, issues: [], events: [{ v: 1, source: "declarative", file: "a.log", line: 1, extractor: "state", fields: { state: { raw: "2", value: "thermal" } } }],
      counts: { total: 1, byExtractor: { state: 1 }, errors: {} }, unmatchedLineCount: 0 };
    const fetchMock = createFetchMock(preview);
    const repository = createRepository(fetchMock);
    const input = { parsing: { schemaVersion: "parsing/v1", extractors: [] }, sampleText: "sample", fileName: "a.log" };
    await expect(repository.parsePreview!("skill/a", input)).resolves.toEqual(preview);
    expect(fetchMock.mock.calls[0][0]).toContain("/log-skills/skill%2Fa/parse-preview");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(input);
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...baseLogDto, evidence: [{ ...baseLogDto.evidence[0], decodedFields: preview.events }] } }));
    await expect(repository.getLog("log-1")).resolves.toMatchObject({ evidence: [{ decodedFields: preview.events }] });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "NOT_FOUND", message: "unavailable", details: {} } }, 404));
    await expect(repository.getSkillSampleText!("skill/a")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: { content: "stored", fileName: "a.log", truncated: false } }));
    await expect(repository.getSkillSampleText!("skill/a")).resolves.toEqual({ text: "stored", fileName: "a.log" });
  });
  it("previews draft signals on the stored sample through the validated HTTP port", async () => {
    const preview = { valid: true, issues: [], hits: [{ ruleId: "timeout", lineNumber: 2, excerpt: "ERROR timeout" }], truncated: true, reason: "hit_cap" };
    const fetchMock = createFetchMock(preview);
    const defaults = { conclusion: "None", impact: "Review", severity: "Info" as const, confidence: 0.5, suggestedActions: [] };
    const input = { signalRules: { rules: [], noHit: defaults, hitDefaults: defaults } };
    await expect(createRepository(fetchMock).signalPreview!("skill/a", input)).resolves.toEqual(preview);
    expect(fetchMock.mock.calls[0][0]).toContain("/log-skills/skill%2Fa/signals-preview");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(input);
  });
  it("sends repeated multipart file parts as one bundle and preserves inventory and evidence paths", async () => {
    const files = [new File(["first"], "a.log"), new File(["second"], "b.log")];
    const inventory = [{ path: "a.log", sizeBytes: 5, lineCount: 1, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }];
    const fetchMock = createFetchMock({ fileObject: { id: "file-1" }, log: { ...baseLogDto, files: inventory,
      evidence: [{ id: "e1", stageId: "rootcause", filePath: "a.log", lineNumbers: [1], inference: "failure", suggestedAction: "inspect" }] }, job: baseJobDto }, 201);
    const result = await createRepository(fetchMock).uploadLog({ file: files[0], files, skillId: "skill-1", analysisQuestion: "why", sourceVersion: "v7" });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.getAll("file")).toEqual(files); expect(form.get("skillId")).toBe("skill-1"); expect(form.get("analysisQuestion")).toBe("why");
    expect(form.get("sourceVersion")).toBe("v7");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Content-Type");
    expect(result.log.files).toEqual(inventory); expect(result.log.evidence[0].filePath).toBe("a.log");
  });
  it("administers integration credentials through validated responses without retaining a secret in list items", async () => {
    const item = { id: "credential/a", organizationId: "org-1", name: "Factory", skillId: null, skillName: null, status: "active", createdBy: "user-1", createdAt: "2026-10-19T12:00:00.000Z", rotatedAt: null, revokedAt: null, lastUsedAt: null };
    const fetchMock = createFetchMock({ items: [item] });
    const repository = createRepository(fetchMock);
    await expect(repository.listIntegrationCredentials!()).resolves.toEqual([item]);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/log-integration-credentials");
    fetchMock.mockResolvedValueOnce(jsonResponse({ item, token: "wie_credential/a_new-secret" }, 201));
    await expect(repository.issueIntegrationCredential!({ name: item.name, skillId: null })).resolves.toMatchObject({ item, token: "wie_credential/a_new-secret" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ name: item.name, skillId: null });
    fetchMock.mockResolvedValueOnce(jsonResponse({ item, token: "wie_credential/a_rotated" }));
    await repository.rotateIntegrationCredential!(item.id);
    expect(fetchMock.mock.calls[2][0]).toContain("/log-integration-credentials/credential%2Fa/rotate");
    fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...item, status: "revoked" } }));
    await expect(repository.revokeIntegrationCredential!(item.id)).resolves.toMatchObject({ status: "revoked" });
    expect(fetchMock.mock.calls[3][0]).toContain("/log-integration-credentials/credential%2Fa/revoke");
  });

  it("reads skill publication summaries and preserves the run revision pin", async () => {
    const skill = { id: "skill-1", skillKey: "device-diagnostics", name: "设备诊断", status: "active", createdAt: "2026-10-18", updatedAt: "2026-10-18",
      currentRevision: { id: "skill-v2", number: 2, publishedAt: "2026-10-18" }, hasDraft: true, hasSourceSnapshots: true,
      readySourceVersions: ["v7"], analyses7d: 4, helpfulRate7d: 0.75 };
    const fetchMock = createFetchMock({ items: [skill] });
    const repository = createRepository(fetchMock);
    await expect(repository.listLogSkills?.({ includeArchived: true })).resolves.toEqual([skill]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-skills?includeArchived=true");
    const knowledgeRevisions = [{ entryId: "6bd19f72-6710-4bbc-9d04-0a30bf151043", revisionId: "11e090bc-c5ef-4544-9900-01adcb20f558" }];
    const provenance = { sourceSnapshot: { id: "source-v7", versionLabel: "v7", status: "ready" }, sourceSnapshotSelection: "matched_version", requestedSourceVersion: "v7" };
    fetchMock.mockResolvedValue(jsonResponse({ item: { ...baseLogDto, knowledgeRevisions, skillRevision: { id: "skill-v2", number: 2 }, ...provenance } }));
    await expect(repository.getLog("log-1")).resolves.toMatchObject({ knowledgeRevisions, skillRevision: { id: "skill-v2", number: 2 }, ...provenance });
  });

  it("sends skillId on upload and preserves explicit pinned rerun policy", async () => {
    const fetchMock = createFetchMock({ fileObject: { id: "file-1" }, log: baseLogDto, job: baseJobDto }, 201);
    const repository = createRepository(fetchMock);
    const file = new File(["INFO ok"], "device.log", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("INFO ok").buffer });
    await repository.uploadLog({ file, skillId: "skill-1", sourceVersion: "v7" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ fileName: "device.log", contentType: "text/plain",
      contentBase64: btoa("INFO ok"), skillId: "skill-1", sourceVersion: "v7" });
    fetchMock.mockResolvedValue(jsonResponse({ log: baseLogDto, job: baseJobDto }));
    await repository.rerunLog({ logId: "log-1", revisionPolicy: "pinned" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ revisionPolicy: "pinned" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists logs with encoded backend filters", async () => {
    const fetchMock = createFetchMock({ items: [baseLogDto] });
    const repository = createRepository(fetchMock);

    await expect(repository.listLogs({ status: "Complete", includeArchived: true })).resolves.toHaveLength(1);

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/logs?status=complete&includeArchived=true");
  });

  it("gets a log by id", async () => {
    const fetchMock = createFetchMock({ item: baseLogDto });
    const repository = createRepository(fetchMock);

    await expect(repository.getLog("log-1")).resolves.toMatchObject({ id: "log-1", status: "Complete" });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/logs/log-1");
  });

  it("returns null when a log is not found", async () => {
    const fetchMock = createFetchMock(
      {
        error: {
          code: "NOT_FOUND",
          message: "Log was not found.",
          details: { logId: "missing" },
          requestId: "req-1"
        }
      },
      404
    );
    const repository = createRepository(fetchMock);

    await expect(repository.getLog("missing")).resolves.toBeNull();
  });

  it("uploads log file content as base64 JSON", async () => {
    const fetchMock = createFetchMock({ fileObject: { id: "file-1" }, log: baseLogDto, job: baseJobDto }, 201);
    const repository = createRepository(fetchMock);
    const file = new File(["timestamp,message\n1,ok"], "diagnostics.csv", { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("timestamp,message\n1,ok").buffer
    });

    await expect(
      repository.uploadLog({
        file,
        analysisQuestion: "Why did charging slow?"
      })
    ).resolves.toMatchObject({ log: { id: "log-1" }, job: { id: "job-1" } });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-files");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" }
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      fileName: "diagnostics.csv",
      contentType: "text/csv",
      contentBase64: btoa("timestamp,message\n1,ok"),
      analysisQuestion: "Why did charging slow?"
    });
  });

  it("uploads a relatedParameterPin with an exact project and binding id", async () => {
    const fetchMock = createFetchMock({ fileObject: { id: "file-1" }, log: baseLogDto, job: baseJobDto }, 201);
    const repository = createRepository(fetchMock);
    const file = new File(["timestamp,message\n1,ok"], "diagnostics.csv", { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("timestamp,message\n1,ok").buffer
    });

    await repository.uploadLog({
      file,
      relatedParameterPin: {
        kind: "canonical-pin",
        projectId: "project-1",
        bindingId: "binding-1",
        definitionRevisionId: "drev-1"
      }
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      fileName: "diagnostics.csv",
      contentType: "text/csv",
      contentBase64: btoa("timestamp,message\n1,ok"),
      relatedParameterPin: {
        kind: "canonical-pin",
        projectId: "project-1",
        bindingId: "binding-1",
        definitionRevisionId: "drev-1"
      }
    });
  });

  it("gets a log analysis job", async () => {
    const fetchMock = createFetchMock({ item: baseJobDto });
    const repository = createRepository(fetchMock);

    await expect(repository.getJob("job-1")).resolves.toEqual(baseJobDto);

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/jobs/job-1");
  });

  it("watches a job by polling when EventSource is unavailable", async () => {
    const fetchMock = createFetchMock({ item: { ...baseJobDto, status: "complete", progress: 100 } });
    const repository = createRepository(fetchMock);

    await new Promise<void>((resolve) => {
      repository.watchJob?.("job-1", (snapshot) => {
        expect(snapshot).toMatchObject({ id: "job-1", status: "complete", progress: 100 });
        resolve();
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/jobs/job-1");
  });

  it("watches a job with EventSource against the configured API base URL", () => {
    const fetchMock = createFetchMock({ item: baseJobDto });
    const addEventListener = vi.fn();
    const close = vi.fn();
    const EventSourceStub = vi.fn(function EventSource(this: unknown, _url: string) {
      Object.assign(this as Record<string, unknown>, { addEventListener, close });
    });
    vi.stubGlobal("EventSource", EventSourceStub);
    const repository = createHttpLogAnalysisRepository({
      apiClient: createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock }),
      baseUrl: "http://127.0.0.1:8787"
    });
    const onEvent = vi.fn();

    const cleanup = repository.watchJob?.("job-1", onEvent);
    const jobHandler = addEventListener.mock.calls.find(([eventName]) => eventName === "job")?.[1] as (event: MessageEvent<string>) => void;
    jobHandler(new MessageEvent("job", { data: JSON.stringify({ ...baseJobDto, status: "complete", progress: 100 }) }));
    cleanup?.();

    expect(EventSourceStub).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/jobs/job-1/events");
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1", status: "complete", progress: 100 }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses the same custom base URL for injected HTTP client and EventSource", async () => {
    const fetchMock = createFetchMock({ item: baseJobDto });
    const addEventListener = vi.fn();
    const close = vi.fn();
    const EventSourceStub = vi.fn(function EventSource(this: unknown, _url: string) {
      Object.assign(this as Record<string, unknown>, { addEventListener, close });
    });
    vi.stubGlobal("EventSource", EventSourceStub);
    const repository = createHttpLogAnalysisRepository({
      apiClient: createApiClient({ baseUrl: "https://logs.example.test", fetchImpl: fetchMock }),
      baseUrl: "https://logs.example.test"
    });

    await repository.getJob("job-1");
    const cleanup = repository.watchJob?.("job-1", vi.fn());
    cleanup?.();

    expect(fetchMock.mock.calls[0][0]).toBe("https://logs.example.test/api/v1/jobs/job-1");
    expect(EventSourceStub).toHaveBeenCalledWith("https://logs.example.test/api/v1/jobs/job-1/events");
  });

  it("falls back to polling when EventSource errors before terminal status", async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchMock({ item: { ...baseJobDto, status: "complete", progress: 100 } });
    const addEventListener = vi.fn();
    const close = vi.fn();
    const EventSourceStub = vi.fn(function EventSource(this: { onerror?: () => void }, _url: string) {
      Object.assign(this, { addEventListener, close });
    });
    vi.stubGlobal("EventSource", EventSourceStub);
    const repository = createHttpLogAnalysisRepository({
      apiClient: createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock }),
      baseUrl: "http://127.0.0.1:8787"
    });
    const onEvent = vi.fn();

    const cleanup = repository.watchJob?.("job-1", onEvent);
    const eventSource = EventSourceStub.mock.instances[0] as unknown as { onerror: () => void };
    eventSource.onerror();
    await vi.runOnlyPendingTimersAsync();

    expect(close).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1", status: "complete", progress: 100 }));

    cleanup?.();
  });

  it("cleanup stops EventSource error polling fallback", async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchMock({ item: { ...baseJobDto, status: "processing", progress: 55 } });
    const addEventListener = vi.fn();
    const close = vi.fn();
    const EventSourceStub = vi.fn(function EventSource(this: { onerror?: () => void }, _url: string) {
      Object.assign(this, { addEventListener, close });
    });
    vi.stubGlobal("EventSource", EventSourceStub);
    const repository = createHttpLogAnalysisRepository({
      apiClient: createApiClient({ baseUrl: "http://127.0.0.1:8787", fetchImpl: fetchMock }),
      baseUrl: "http://127.0.0.1:8787"
    });
    const onEvent = vi.fn();

    const cleanup = repository.watchJob?.("job-1", onEvent);
    const eventSource = EventSourceStub.mock.instances[0] as unknown as { onerror: () => void };
    eventSource.onerror();
    cleanup?.();
    await vi.runOnlyPendingTimersAsync();

    expect(close).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("reruns a log analysis", async () => {
    const fetchMock = createFetchMock({ log: baseLogDto, job: baseJobDto });
    const repository = createRepository(fetchMock);

    await expect(repository.rerunLog({ logId: "log-1", analysisQuestion: "Check again" })).resolves.toMatchObject({
      log: { id: "log-1" },
      job: { id: "job-1" }
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/logs/log-1/rerun");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ analysisQuestion: "Check again" });
  });

  it("lists feedback insights with the time window and maps rows through the DTO", async () => {
    const fetchMock = createFetchMock({
      items: [
        {
          logDomainId: "domain-charging",
          logDomainName: "charging-power",
          analysisSource: "agent",
          promptVersion: "log-analysis/v2",
          totalCount: 4,
          helpfulCount: 3,
          helpfulRate: 0.75,
          lastFeedbackAt: "2026-08-13T02:00:00.000Z"
        }
      ]
    });
    const repository = createRepository(fetchMock);

    const items = await repository.listFeedbackInsights!({ timeWindow: "7d" });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/logs/feedback-insights?timeWindow=7d");
    expect(items).toEqual([
      expect.objectContaining({ logDomainName: "charging-power", helpfulRate: 0.75, totalCount: 4 })
    ]);
  });

  it("archives, unarchives, and submits feedback to expected endpoints", async () => {
    const fetchMock = createFetchMock({ ok: true });
    const repository = createRepository(fetchMock);

    await repository.archiveLog("log-1");
    await repository.unarchiveLog("log-1");
    await repository.submitFeedback({ logId: "log-1", rating: "helpful", note: "Matched the event." });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8787/api/v1/logs/log-1/archive",
      "http://127.0.0.1:8787/api/v1/logs/log-1/unarchive",
      "http://127.0.0.1:8787/api/v1/logs/log-1/feedback"
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ rating: "helpful", note: "Matched the event." });
  });

  it("rethrows API errors", async () => {
    const fetchMock = createFetchMock(
      {
        error: {
          code: "FORBIDDEN",
          message: "Forbidden.",
          details: { permission: "logs:view" },
          requestId: "req-1"
        }
      },
      403
    );
    const repository = createRepository(fetchMock);

    await expect(repository.listLogs()).rejects.toBeInstanceOf(WiseEffApiError);
  });

  it("uses the administrator trace and skill dry-run endpoints with contract validation", async () => {
    const run = { id: "run/one", skillRevisionId: "draft", status: "processing", progress: 10, report: null, error: null, createdAt: "2026-10-19T00:00:00Z" };
    const step = { index: 1, kind: "model-turn", tool: null, arguments: {}, resultBytes: 12, lines: [], outcome: "ok", reason: null };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ run }))
      .mockResolvedValueOnce(jsonResponse({ run, steps: [step] }))
      .mockResolvedValueOnce(jsonResponse({ steps: [step] }))
      .mockResolvedValueOnce(jsonResponse({ item: { file: "sample.log", startLine: 1, endLine: 1, totalLines: 1, lines: [{ lineNumber: 1, content: "sample" }] } }))
      .mockResolvedValueOnce(jsonResponse({ steps: [{ ...step, arguments: { query: "x".repeat(121) } }] }));
    const repository = createRepository(fetchMock);
    await expect(repository.startSkillDryRun!("skill/one")).resolves.toEqual(run);
    await expect(repository.getSkillDryRun!("skill/one", run.id)).resolves.toEqual({ run, steps: [step] });
    await expect(repository.getLogTrace!("log/one")).resolves.toEqual([step]);
    await repository.getSkillDryRunLines!("skill/one", run.id, "sample.log", 1, 101);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:8787/api/v1/log-skills/skill%2Fone/dry-runs",
      "http://127.0.0.1:8787/api/v1/log-skills/skill%2Fone/dry-runs/run%2Fone",
      "http://127.0.0.1:8787/api/v1/logs/log%2Fone/trace",
      "http://127.0.0.1:8787/api/v1/log-skills/skill%2Fone/dry-runs/run%2Fone/lines?file=sample.log&startLine=1&endLine=101"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    await expect(repository.getLogTrace!("log/one")).rejects.toMatchObject({ code: "INTERNAL_ERROR", details: { reason: "contract-drift" } });
  });

  it("lists a domain's knowledge links", async () => {
    const fetchMock = createFetchMock({
      items: [
        {
          id: "link-1",
          logDomainId: "domain-1",
          knowledgeEntryId: "entry-1",
          entryTitle: "E_THERMAL_FOLDBACK handbook",
          entryStatus: "published",
          entryTags: ["charging"],
          linkedAt: "2026-08-13T00:00:00.000Z"
        }
      ]
    });
    const repository = createRepository(fetchMock);

    await expect(repository.listLogDomainKnowledgeLinks?.("domain-1")).resolves.toEqual([
      expect.objectContaining({ knowledgeEntryId: "entry-1", entryStatus: "published" })
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-domains/domain-1/knowledge-links");
  });

  it("replaces a domain's knowledge links with PUT semantics", async () => {
    const fetchMock = createFetchMock({ items: [] });
    const repository = createRepository(fetchMock);

    await repository.setLogDomainKnowledgeLinks?.({ domainId: "domain-1", knowledgeEntryIds: ["entry-1", "entry-2"] });

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-domains/domain-1/knowledge-links");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ knowledgeEntryIds: ["entry-1", "entry-2"] });
  });
});
