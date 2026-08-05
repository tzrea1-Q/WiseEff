import { describe, expect, it } from "vitest";
import {
  buildParameterAdminProjectsFromState,
  mapProjectAdminSummaryDto,
  summarizeParameterAdminProjects
} from "./parameterAdminProjects";
import { initialState } from "./mockData";

describe("parameterAdminProjects", () => {
  it("builds project rows from mock state", () => {
    const rows = buildParameterAdminProjectsFromState(initialState);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      code: expect.any(String),
      moduleCount: expect.any(Number),
      parameterCount: expect.any(Number),
      openConflictCount: expect.any(Number),
      releasedBaselineCount: expect.any(Number),
      baselineLabel: expect.any(String)
    });
  });

  it("summarizes project KPIs", () => {
    const rows = buildParameterAdminProjectsFromState(initialState);
    const summary = summarizeParameterAdminProjects(rows);
    expect(summary.total).toBe(rows.length);
    expect(summary.moduleTotal).toBeGreaterThanOrEqual(0);
    expect(summary.openConflicts).toBeGreaterThanOrEqual(0);
    expect(summary.withoutReleasedBaseline).toBeGreaterThanOrEqual(0);
  });

  it("maps API summaries so non-initialized init status wins over ops status", () => {
    const row = mapProjectAdminSummaryDto({
      id: "c1-init",
      name: "C1 Init Verify",
      code: "C1-INIT",
      status: "initialized",
      initializationStatus: "not_initialized",
      moduleCount: 0,
      parameterCount: 0,
      openConflictCount: 0,
      releasedBaselineCount: 0,
      updatedAt: "2026-08-05T12:00:00.000Z"
    });
    expect(row.status).toBe("not_initialized");
    expect(row.statusLabel).toBe("未初始化");
  });

  it("maps API summaries to ops status once initialization is complete", () => {
    const row = mapProjectAdminSummaryDto({
      id: "aurora",
      name: "Aurora",
      code: "AUR",
      status: "maintenance",
      initializationStatus: "initialized",
      moduleCount: 1,
      parameterCount: 2,
      openConflictCount: 0,
      releasedBaselineCount: 1,
      updatedAt: "2026-08-05T12:00:00.000Z"
    });
    expect(row.status).toBe("maintenance");
    expect(row.statusLabel).toBe("维护");
  });
});
