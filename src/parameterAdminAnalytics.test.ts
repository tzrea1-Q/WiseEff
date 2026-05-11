import { describe, expect, it } from "vitest";
import { buildAuditEvent, getCoverage, migrateParameterRange, selectDirtyCount } from "./parameterAdminAnalytics";
import { initialState } from "./mockData";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "./powerManagementConfig";

describe("getCoverage", () => {
  const projects: PowerManagementProject[] = [
    { id: "aurora", name: "Aurora", code: "AUR" },
    { id: "nebula", name: "Nebula", code: "NEB" },
    { id: "atlas", name: "Atlas", code: "ATL" }
  ];

  it("returns full when every project has a current value", () => {
    const parameter = {
      id: "p1",
      values: {
        aurora: { currentValue: "3200", updatedAt: "", recommendedValue: "" },
        nebula: { currentValue: "3400", updatedAt: "", recommendedValue: "" },
        atlas: { currentValue: "3000", updatedAt: "", recommendedValue: "" }
      }
    } as PowerManagementParameterTemplate;

    expect(getCoverage(parameter, projects)).toBe("full");
  });

  it("returns partial when at least one project value is empty or missing", () => {
    const parameter = {
      id: "p1",
      values: {
        aurora: { currentValue: "3200", updatedAt: "", recommendedValue: "" },
        nebula: { currentValue: "", updatedAt: "", recommendedValue: "" }
      }
    } as PowerManagementParameterTemplate;

    expect(getCoverage(parameter, projects)).toBe("partial");
  });

  it("returns orphan when no project has a current value", () => {
    const parameter = {
      id: "p1",
      values: {
        aurora: { currentValue: "", updatedAt: "", recommendedValue: "" },
        nebula: { currentValue: "", updatedAt: "", recommendedValue: "" },
        atlas: { currentValue: "", updatedAt: "", recommendedValue: "" }
      }
    } as PowerManagementParameterTemplate;

    expect(getCoverage(parameter, projects)).toBe("orphan");
  });
});

describe("selectDirtyCount", () => {
  it("returns 0 when last exported snapshot equals the draft", () => {
    expect(selectDirtyCount(initialState)).toBe(0);
  });

  it("returns a non-zero count when the draft differs from the last exported snapshot", () => {
    const patched = {
      ...initialState,
      lastExportedSnapshot: JSON.stringify({ ...initialState.configDraft, extraField: 1 })
    };

    expect(selectDirtyCount(patched)).toBeGreaterThan(0);
  });

  it("increases or stays equal as more parameters differ", () => {
    const oneDiff = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: [
          { ...initialState.configDraft.parameterLibrary[0], description: "changed" },
          ...initialState.configDraft.parameterLibrary.slice(1)
        ]
      }
    };
    const twoDiff = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        parameterLibrary: [
          { ...initialState.configDraft.parameterLibrary[0], description: "changed1" },
          { ...initialState.configDraft.parameterLibrary[1], description: "changed2" },
          ...initialState.configDraft.parameterLibrary.slice(2)
        ]
      }
    };

    expect(selectDirtyCount(twoDiff)).toBeGreaterThanOrEqual(selectDirtyCount(oneDiff));
  });
});

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
