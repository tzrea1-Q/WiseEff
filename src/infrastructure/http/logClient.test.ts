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

describe("createHttpLogAnalysisRepository", () => {
  it("sends repeated multipart file parts as one bundle and preserves inventory and evidence paths", async () => {
    const files = [new File(["first"], "a.log"), new File(["second"], "b.log")];
    const inventory = [{ path: "a.log", sizeBytes: 5, lineCount: 1, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }];
    const fetchMock = createFetchMock({ fileObject: { id: "file-1" }, log: { ...baseLogDto, files: inventory,
      evidence: [{ id: "e1", stageId: "rootcause", filePath: "a.log", lineNumbers: [1], inference: "failure", suggestedAction: "inspect" }] }, job: baseJobDto }, 201);
    const result = await createRepository(fetchMock).uploadLog({ file: files[0], files, skillId: "skill-1", analysisQuestion: "why" });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.getAll("file")).toEqual(files); expect(form.get("skillId")).toBe("skill-1"); expect(form.get("analysisQuestion")).toBe("why");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Content-Type");
    expect(result.log.files).toEqual(inventory); expect(result.log.evidence[0].filePath).toBe("a.log");
  });
  it("reads skill publication summaries and preserves the run revision pin", async () => {
    const skill = { id: "skill-1", name: "设备诊断", status: "active", createdAt: "2026-10-18", updatedAt: "2026-10-18",
      currentRevision: { id: "skill-v2", number: 2, publishedAt: "2026-10-18" }, hasDraft: true, analyses7d: 4, helpfulRate7d: 0.75 };
    const fetchMock = createFetchMock({ items: [skill] });
    const repository = createRepository(fetchMock);
    await expect(repository.listLogSkills?.({ includeArchived: true })).resolves.toEqual([skill]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/api/v1/log-skills?includeArchived=true");
    fetchMock.mockResolvedValue(jsonResponse({ item: { ...baseLogDto, skillRevision: { id: "skill-v2", number: 2 } } }));
    await expect(repository.getLog("log-1")).resolves.toMatchObject({ skillRevision: { id: "skill-v2", number: 2 } });
  });

  it("sends skillId on upload and preserves explicit pinned rerun policy", async () => {
    const fetchMock = createFetchMock({ fileObject: { id: "file-1" }, log: baseLogDto, job: baseJobDto }, 201);
    const repository = createRepository(fetchMock);
    const file = new File(["INFO ok"], "device.log", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("INFO ok").buffer });
    await repository.uploadLog({ file, skillId: "skill-1" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ fileName: "device.log", contentType: "text/plain",
      contentBase64: btoa("INFO ok"), skillId: "skill-1" });
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
