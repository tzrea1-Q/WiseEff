import { describe, expect, it } from "vitest";
import { buildAuditEvent, migrateParameterRange } from "./parameterAdminAnalytics";

describe("migrateParameterRange", () => {
  it("parses numeric min and max ranges", () => {
    expect(migrateParameterRange("2500 - 4500")).toEqual({ min: 2500, max: 4500, raw: "2500 - 4500" });
  });

  it("parses negative values separated by tilde", () => {
    const range = migrateParameterRange("-10 ~ 50");
    expect(range.min).toBe(-10);
    expect(range.max).toBe(50);
  });

  it("preserves unparseable strings as raw", () => {
    expect(migrateParameterRange("High/Low")).toEqual({ raw: "High/Low" });
  });

  it("handles unit-suffixed values", () => {
    const range = migrateParameterRange("2500mA - 4500mA");
    expect(range.min).toBe(2500);
    expect(range.max).toBe(4500);
  });
});

describe("buildAuditEvent", () => {
  it("builds a parameter-admin audit event with required fields", () => {
    const event = buildAuditEvent({
      kind: "parameter-update",
      actor: "Xu Yun",
      action: "test",
      severity: "Low",
      parameterId: "p1"
    });

    expect(event.id).toMatch(/^audit-/);
    expect(event.app).toBe("parameter-admin");
    expect(event.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.kind).toBe("parameter-update");
    expect(event.parameterId).toBe("p1");
  });

  it("passes through optional metadata", () => {
    const event = buildAuditEvent({
      kind: "batch-import",
      actor: "Agent",
      action: "t",
      severity: "Medium",
      batchId: "BI-X",
      userId: "u-xu-yun",
      metadata: { diffSummary: { added: 1, updated: 0, deleted: 0 } },
      viaAgent: true
    });

    expect(event.batchId).toBe("BI-X");
    expect(event.userId).toBe("u-xu-yun");
    expect(event.viaAgent).toBe(true);
    expect(event.metadata?.diffSummary?.added).toBe(1);
  });
});
