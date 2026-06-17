import { describe, expect, it } from "vitest";
import { buildAuditSearch, parseAuditSearch } from "./useAuditSearch";

describe("useAuditSearch helpers", () => {
  it("parses audit search params", () => {
    expect(parseAuditSearch("?app=parameter&severity=High&projectId=aurora&traceId=trace-1&q=merge")).toEqual({
      appGroup: "parameter",
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
