import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditTimeWindowFrom, useAuditEvents, useAuditEvent, useAuditTraceEvents, type AuditQueryState } from "./useAuditEvents";
import type { AuditEventDto, AuditEventListResponse } from "@/domain/audit/types";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/infrastructure/http/auditClient", () => ({ createAuditClient: () => ({ listAuditEvents: request }) }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const query: AuditQueryState = { appGroup: "all", severity: "all", search: "", timeWindow: "all" };
const dto = (id: string): AuditEventDto => ({ id, organizationId: "org", projectId: "project", actorUserId: null,
  actorType: "system", app: "parameter-bindings", kind: "project-value", action: "project-value-appended", severity: "info",
  targetType: "project-value", targetId: id, metadata: {}, traceId: "trace-1", createdAt: "2026-10-15T00:00:00Z" });

describe("audit request lifecycle", () => {
  it("sends multi-severity filters through initial reads and exports", async () => {
    request.mockResolvedValue({ items: [dto("one")], nextCursor: null });
    const multiQuery: AuditQueryState = { ...query, severity: ["High", "info"] };
    const { result } = renderHook(() => useAuditEvents({ isApiMode: true, mockEvents: [], query: multiQuery }));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    await act(async () => { await result.current.fetchAllForExport(); });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [params] of request.mock.calls) {
      expect(params).toMatchObject({ severities: ["High", "info"], severity: undefined });
    }
  });
  it("applies the same OR semantics to mock records", () => {
    const mockEvents = (["High", "Medium", "Low"] as const).map((severity) => ({ id: severity, severity, app: "parameters", kind: "parameter-update", action: "更新", actor: "用户", time: "刚刚" }));
    const multiQuery: AuditQueryState = { ...query, severity: ["High", "Medium"] };
    const { result } = renderHook(() => useAuditEvents({ isApiMode: false, mockEvents, query: multiQuery }));
    expect(result.current.events.map((event) => event.id)).toEqual(["High", "Medium"]);
  });
  it("refreshes relative time windows across midnight and freezes the new boundary for pagination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
    request.mockResolvedValue({ items: [dto("one")], nextCursor: "next" });
    const { result } = renderHook(() => useAuditEvents({ isApiMode: true, mockEvents: [], query: { ...query, timeWindow: "today" } }));
    await act(async () => {});
    const oldFrom = request.mock.calls[0][0].from;
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
    await act(async () => { await result.current.reload(); });
    const refreshedFrom = request.mock.calls[1][0].from;
    expect(refreshedFrom).not.toBe(oldFrom);
    expect(refreshedFrom).toBe(auditTimeWindowFrom("today"));
    vi.setSystemTime(new Date("2026-10-18T18:00:00Z"));
    await act(async () => { await result.current.loadMore(); });
    expect(request.mock.calls[2][0].from).toBe(refreshedFrom);
  });
  it("ignores an older search response arriving after the new result", async () => {
    let resolveOld!: (value: AuditEventListResponse) => void;
    let resolveNew!: (value: AuditEventListResponse) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    const { result, rerender } = renderHook(({ search }) => useAuditEvents({ isApiMode: true, mockEvents: [], query: { ...query, search } }), { initialProps: { search: "old" } });
    rerender({ search: "new" });
    await act(async () => { resolveNew({ items: [dto("new")], nextCursor: null }); });
    await act(async () => { resolveOld({ items: [dto("old")], nextCursor: "old-cursor" }); });
    expect(result.current.events.map((event) => event.id)).toEqual(["new"]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("appends one batch without duplicate records or inner pagination", async () => {
    request.mockResolvedValueOnce({ items: [dto("one")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [dto("one"), dto("two")], nextCursor: null });
    const { result } = renderHook(() => useAuditEvents({ isApiMode: true, mockEvents: [], query }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.events.map((event) => event.id)).toEqual(["one", "two"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("does not append an old filter's pending load-more batch", async () => {
    let resolveMore!: (value: AuditEventListResponse) => void;
    request.mockResolvedValueOnce({ items: [dto("one")], nextCursor: "cursor-1" })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }))
      .mockResolvedValueOnce({ items: [dto("new")], nextCursor: null });
    const { result, rerender } = renderHook(({ search }) => useAuditEvents({ isApiMode: true, mockEvents: [], query: { ...query, search } }), { initialProps: { search: "old" } });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => { void result.current.loadMore(); });
    rerender({ search: "new" });
    await waitFor(() => expect(result.current.events[0]?.id).toBe("new"));
    await act(async () => { resolveMore({ items: [dto("old-more")], nextCursor: null }); });
    expect(result.current.events.map((event) => event.id)).toEqual(["new"]);
  });

  it("resolves a deep-linked detail outside the loaded list", async () => {
    request.mockResolvedValue({ items: [dto("outside")], nextCursor: null });
    const { result } = renderHook(() => useAuditEvent("outside", undefined, true, []));
    await waitFor(() => expect(result.current.event?.id).toBe("outside"));
    expect(request).toHaveBeenCalledWith({ eventId: "outside", limit: 1 });
  });

  it("exposes a trace error and can retry instead of hiding the chain", async () => {
    request.mockRejectedValueOnce(new Error("网络暂不可用")).mockResolvedValue({ items: [dto("one")], nextCursor: "more" });
    const { result } = renderHook(() => useAuditTraceEvents("trace-1", true, []));
    await waitFor(() => expect(result.current.error).toContain("网络"));
    await act(async () => { await result.current.reload(); });
    expect(result.current.relatedEvents[0]?.id).toBe("one");
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBe("");
  });

  it("reports export truncation explicitly at 2000 rows", async () => {
    request.mockImplementation(async (params) => {
      if (params.limit === 20) return { items: [dto("initial")], nextCursor: "next" };
      const offset = Number(params.cursor ?? 0);
      return { items: Array.from({ length: 100 }, (_, index) => dto(String(offset + index))), nextCursor: String(offset + 100) };
    });
    const { result } = renderHook(() => useAuditEvents({ isApiMode: true, mockEvents: [], query }));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    let exported!: Awaited<ReturnType<typeof result.current.fetchAllForExport>>;
    await act(async () => { exported = await result.current.fetchAllForExport(); });
    expect(exported.rows).toHaveLength(2000);
    expect(exported.truncated).toBe(true);
    expect(new Set(exported.rows.map((event) => event.id)).size).toBe(2000);
  });
});

describe("auditTimeWindowFrom", () => {
  it("maps windows to start timestamps", () => {
    const now = new Date("2026-08-13T10:00:00.000Z");
    expect(auditTimeWindowFrom("all", now)).toBeUndefined();
    expect(auditTimeWindowFrom("7d", now)).toBe("2026-08-06T10:00:00.000Z");
    expect(auditTimeWindowFrom("30d", now)).toBe("2026-07-14T10:00:00.000Z");
    expect(auditTimeWindowFrom("today", now)?.endsWith("Z")).toBe(true);
  });
});
