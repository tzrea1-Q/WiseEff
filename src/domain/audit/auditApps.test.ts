import { describe, expect, it } from "vitest";
import { getAuditAppLabel, matchesAuditAppGroup } from "./auditApps";

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

  it("covers canonical parameters, authentication, devices and assistant writers", () => {
    for (const app of ["parameters", "parameter-bindings", "parameter-catalog", "parameter-catalog-migration"]) {
      expect(matchesAuditAppGroup(app, "parameter", "api")).toBe(true);
      expect(getAuditAppLabel(app)).not.toBe(app);
    }
    expect(matchesAuditAppGroup("auth", "users", "api")).toBe(true);
    expect(matchesAuditAppGroup("device-bridge", "debugging", "api")).toBe(true);
    expect(matchesAuditAppGroup("dts-reload", "debugging", "api")).toBe(true);
    expect(matchesAuditAppGroup("wiseeff", "agent", "api")).toBe(true);
    expect(getAuditAppLabel("auth")).toBe("账号与登录");
    expect(getAuditAppLabel("unknown-new-module")).toBe("未分类模块");
  });
});
