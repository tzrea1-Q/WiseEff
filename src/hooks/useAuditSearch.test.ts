import { describe, expect, it } from "vitest";
import { buildAuditSearch, parseAuditSearch } from "./useAuditSearch";

describe("useAuditSearch helpers", () => {
  it("round-trips multiple severities, deduplicates them, and keeps legacy single selections", () => {
    const query = parseAuditSearch("?severity=Medium,High,High,invalid");
    expect(query.severity).toEqual(["High", "Medium"]);
    expect(buildAuditSearch(query)).toBe("?severity=High%2CMedium");
    expect(parseAuditSearch("?severity=info").severity).toBe("info");
    expect(parseAuditSearch("?severity=invalid").severity).toBe("all");
  });
  it("parses audit search params", () => {
    expect(parseAuditSearch("?app=parameter&severity=High&projectId=aurora&traceId=trace-1&q=merge")).toEqual({
      appGroup: "parameter",
      timeWindow: "all",
      severity: "High",
      projectId: "aurora",
      traceId: "trace-1",
      search: "merge"
    });
  });

  it("builds audit search params", () => {
    expect(
      buildAuditSearch({
        appGroup: "logs",
        severity: "Medium",
        search: "archive",
        projectId: "aurora"
      })
    ).toBe("?app=logs&severity=Medium&q=archive&projectId=aurora");
  });
});

describe("audit time window", () => {
  it("round-trips tw through the audit URL", () => {
    const built = buildAuditSearch({ appGroup: "all", severity: "all", search: "", timeWindow: "7d" });
    expect(built).toBe("?tw=7d");
    expect(parseAuditSearch(built).timeWindow).toBe("7d");
  });

  it("falls back to all for unknown tw values", () => {
    expect(parseAuditSearch("?tw=nonsense").timeWindow).toBe("all");
  });

  it("round-trips detail and advanced filters while validating enumerations", () => {
    const built = buildAuditSearch({ appGroup: "parameter", severity: "info", search: "系统", timeWindow: "custom",
      eventId: "event-1", kind: "project-value", targetId: "value-1", from: "2026-10-01T00:00:00Z", to: "2026-10-15T00:00:00Z" });
    expect(parseAuditSearch(built)).toMatchObject({ eventId: "event-1", severity: "info", kind: "project-value", targetId: "value-1", timeWindow: "custom", from: "2026-10-01T00:00:00Z" });
    expect(parseAuditSearch("?app=invalid&severity=invalid")).toMatchObject({ appGroup: "all", severity: "all" });
  });
});
