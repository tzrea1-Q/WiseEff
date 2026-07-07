import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient, WiseEffApiError } from "./apiClient";
import { createHttpLogAnalysisRepository } from "./logClient";
import type { LogJobDto, LogRecordDto } from "./logDtos";

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

describe("createHttpLogAnalysisRepository", () => {
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
        analysisQuestion: "Why did charging slow?",
        relatedParameterId: "fast-charge-current"
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
      analysisQuestion: "Why did charging slow?",
      relatedParameterId: "fast-charge-current"
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
});
