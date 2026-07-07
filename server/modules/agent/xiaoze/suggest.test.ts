import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { runXiaozeSuggest } from "./suggest";

describe("runXiaozeSuggest", () => {
  it("produces Chinese parameter suggestions from project overview data", async () => {
    const runTool = vi.fn().mockResolvedValue({
      summary: "Project p1: 12 parameters, 3 open change requests.",
      data: { open_change_requests: 3 },
      citations: [{ type: "parameter", id: "p1", label: "x" }]
    });
    const result = await runXiaozeSuggest({
      context: { projectId: "p1", projectName: "Aurora 量产平台", pageKey: "parameter-review" },
      runTool,
      listReadTools: () => ["perception.getProjectOverview", "perception.getRecentLogConclusions"]
    });
    expect(result.suggestions[0]?.headline).toBe("当前有 3 条参数变更待审阅");
    expect(result.suggestions[0]?.meta).toBe("项目：Aurora 量产平台");
    expect(runTool).toHaveBeenCalledWith("perception.getProjectOverview", { projectId: "p1" });
  });

  it("uses recent log conclusions on the logs page", async () => {
    const runTool = vi.fn().mockResolvedValue({
      summary: "Most recent log conclusion: thermal throttling detected",
      data: {
        logs: [{ status: "Failed", conclusion: "thermal throttling detected", severity: "high" }]
      },
      citations: [{ type: "log", id: "log-1", label: "failed log" }]
    });
    const result = await runXiaozeSuggest({
      context: { pageKey: "logs" },
      runTool,
      listReadTools: () => ["perception.getProjectOverview", "perception.getRecentLogConclusions"]
    });
    expect(result.suggestions[0]?.headline).toBe("有 1 条日志分析失败，建议优先查看");
    expect(result.suggestions[0]?.meta).toBe("组织范围");
    expect(runTool).toHaveBeenCalledWith("perception.getRecentLogConclusions", {});
    expect(runTool).not.toHaveBeenCalledWith("perception.getProjectOverview", expect.anything());
  });

  it("returns nothing when parameter overview has no pending change requests", async () => {
    const runTool = vi.fn().mockResolvedValue({
      summary: "Project p1: 12 parameters, 0 open change requests.",
      data: { open_change_requests: 0 },
      citations: []
    });
    const result = await runXiaozeSuggest({
      context: { projectId: "p1", pageKey: "parameters" },
      runTool,
      listReadTools: () => ["perception.getProjectOverview"]
    });
    expect(result.suggestions).toEqual([]);
  });

  it("never calls a mutating tool", async () => {
    const runTool = vi.fn();
    await runXiaozeSuggest({
      context: { pageKey: "parameters" },
      runTool,
      listReadTools: () => []
    });
    expect(runTool).not.toHaveBeenCalledWith(expect.stringContaining("action."), expect.anything());
  });

  it("returns nothing for unsupported pages", async () => {
    const runTool = vi.fn();
    const result = await runXiaozeSuggest({
      context: { projectId: "p1", pageKey: "parameter-home" },
      runTool,
      listReadTools: () => ["perception.getProjectOverview"]
    });
    expect(result.suggestions).toEqual([]);
    expect(runTool).not.toHaveBeenCalled();
  });

  it("returns nothing for forbidden project access", async () => {
    const runTool = vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", "denied", 403));
    const result = await runXiaozeSuggest({
      context: { projectId: "secret", pageKey: "parameters" },
      runTool,
      listReadTools: () => ["perception.getProjectOverview"]
    });
    expect(result.suggestions).toEqual([]);
  });
});
