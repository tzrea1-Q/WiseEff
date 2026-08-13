import { describe, expect, it } from "vitest";
import { buildAuditSearch, parseAuditSearch } from "./useAuditSearch";

describe("useAuditSearch helpers", () => {
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
});
