import { describe, expect, it } from "vitest";
import { buildParameterAdminProjectsFromState, summarizeParameterAdminProjects } from "./parameterAdminProjects";
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
      parameterCount: expect.any(Number)
    });
  });

  it("summarizes project KPIs", () => {
    const rows = buildParameterAdminProjectsFromState(initialState);
    const summary = summarizeParameterAdminProjects(rows);
    expect(summary.total).toBe(rows.length);
    expect(summary.moduleTotal).toBeGreaterThanOrEqual(0);
  });
});
