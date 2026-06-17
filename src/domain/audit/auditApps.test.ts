import { describe, expect, it } from "vitest";
import { matchesAuditAppGroup } from "./auditApps";

describe("auditApps", () => {
  it("matches mock parameter apps for parameter group", () => {
    expect(matchesAuditAppGroup("parameter-admin", "parameter", "mock")).toBe(true);
    expect(matchesAuditAppGroup("parameters", "parameter", "mock")).toBe(true);
    expect(matchesAuditAppGroup("logs", "parameter", "mock")).toBe(false);
  });

  it("matches API apps for logs group", () => {
    expect(matchesAuditAppGroup("log-analysis", "logs", "api")).toBe(true);
    expect(matchesAuditAppGroup("logs", "logs", "api")).toBe(false);
  });
});
