import { describe, expect, it, vi } from "vitest";
import { createHttpQualityJudge } from "./judgeFromEnv";
import type { GoldenLogCase } from "./goldenCases";
import type { AnalyzeLogOutput } from "../analyzer";

describe("HTTP quality judge", () => {
  it("reads a verdict after a leading reasoning block and leaves room for the reasoning", async () => {
    const requests: Array<{ max_tokens: number }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const content = '<think>Point 1 is {covered}.</think>\n{"rootCauseScore":1,"categoryMatch":true,"actionsScore":0.5,"reasoning":"covered"}';
      return Response.json({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 10 } });
    });
    try {
      const judge = createHttpQualityJudge({ LOG_ANALYSIS_JUDGE_API_BASE_URL: "https://judge.example.invalid/v1",
        LOG_ANALYSIS_JUDGE_API_KEY: "fixture-key", LOG_ANALYSIS_JUDGE_API_TIMEOUT_MS: 1000 });
      const score = await judge.score({
        goldenCase: { rootCauseCategory: "thermal-protection", rootCausePoints: ["Thermal foldback"], expectedActions: ["Inspect cooling"] } as GoldenLogCase,
        output: { conclusion: "热保护降额", impact: "电流下降", suggestedActions: ["检查散热"], evidence: [] } as unknown as AnalyzeLogOutput
      });
      expect(score).toMatchObject({ rootCauseScore: 1, categoryMatch: true, actionsScore: 0.5 });
      expect(requests[0].max_tokens).toBeGreaterThanOrEqual(2048);
    } finally { fetch.mockRestore(); }
  });
});
