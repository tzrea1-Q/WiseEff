import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { runXiaozeSuggest } from "./suggest";

describe("runXiaozeSuggest", () => {
  it("produces grounded read-only suggestions", async () => {
    const runTool = vi.fn().mockResolvedValue({
      summary: "3 high-risk parameters pending review",
      data: {},
      citations: [{ type: "parameter", id: "p1", label: "x" }]
    });
    const result = await runXiaozeSuggest({
      context: { projectId: "p1", pageKey: "parameter-review" },
      runTool,
      listReadTools: () => ["perception.getProjectOverview"]
    });
    expect(result.suggestions[0]?.headline).toContain("pending review");
    expect(runTool).toHaveBeenCalledWith("perception.getProjectOverview", { projectId: "p1" });
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
