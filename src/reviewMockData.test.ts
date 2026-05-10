import { describe, expect, it } from "vitest";
import {
  buildAISuggestion,
  buildImpactItems,
  buildParameterHistory,
  buildReviewMockRequests,
  REVIEW_MOCK_NOW
} from "./reviewMockData";

describe("buildAISuggestion", () => {
  it("produces a suggestion object with the required spec fields", () => {
    const suggestion = buildAISuggestion({
      recommendation: "advance",
      confidence: "high",
      summary: "建议推进。",
      reasons: ["a", "b", "c"],
      similarRequests: ["PRQ-1", "PRQ-2"]
    });

    expect(suggestion.recommendation).toBe("advance");
    expect(suggestion.confidence).toBe("high");
    expect(suggestion.reasons).toHaveLength(3);
    expect(suggestion.similarRequests).toHaveLength(2);
  });
});

describe("buildImpactItems", () => {
  it("generates impact items covering module, test, and parameter kinds", () => {
    const items = buildImpactItems("charging");
    const kinds = new Set(items.map((item) => item.kind));

    expect(kinds.has("module")).toBe(true);
    expect(kinds.has("test")).toBe(true);
    expect(kinds.has("parameter")).toBe(true);
  });

  it("gives every impact item a name, note, and risk", () => {
    const items = buildImpactItems("battery-safety");

    items.forEach((item) => {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.note.length).toBeGreaterThan(0);
      expect(["High", "Medium", "Low"]).toContain(item.risk);
    });
  });
});

describe("buildParameterHistory", () => {
  it("returns at least 5 entries sorted by changedAt with valid ISO timestamps", () => {
    const entries = buildParameterHistory("aurora-fast-charge-current");

    expect(entries.length).toBeGreaterThanOrEqual(5);
    const timestamps = entries.map((entry) => new Date(entry.changedAt).getTime());
    timestamps.forEach((timestamp) => expect(Number.isNaN(timestamp)).toBe(false));
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });

  it("returns non-empty value, version, and changedBy fields", () => {
    const entries = buildParameterHistory("aurora-battery-temp-target");

    entries.forEach((entry) => {
      expect(entry.value.length).toBeGreaterThan(0);
      expect(entry.version.length).toBeGreaterThan(0);
      expect(entry.changedBy.length).toBeGreaterThan(0);
    });
  });
});

describe("buildReviewMockRequests", () => {
  const requests = buildReviewMockRequests();

  it("returns at least 10 requests", () => {
    expect(requests.length).toBeGreaterThanOrEqual(10);
  });

  it("covers all 3 AI recommendation values", () => {
    const recommendations = new Set(requests.map((request) => request.aiSuggestion.recommendation));

    expect(recommendations.has("advance")).toBe(true);
    expect(recommendations.has("reject")).toBe(true);
    expect(recommendations.has("needs-review")).toBe(true);
  });

  it("includes at least 3 high-confidence advances and 2 high-confidence rejects", () => {
    const advanceHigh = requests.filter(
      (request) => request.aiSuggestion.recommendation === "advance" && request.aiSuggestion.confidence === "high"
    );
    const rejectHigh = requests.filter(
      (request) => request.aiSuggestion.recommendation === "reject" && request.aiSuggestion.confidence === "high"
    );

    expect(advanceHigh.length).toBeGreaterThanOrEqual(3);
    expect(rejectHigh.length).toBeGreaterThanOrEqual(2);
  });

  it("covers all 5 request statuses", () => {
    const statuses = new Set(requests.map((request) => request.status));

    expect(statuses.has("待审阅")).toBe(true);
    expect(statuses.has("自动检查通过")).toBe(true);
    expect(statuses.has("等待合入")).toBe(true);
    expect(statuses.has("已合入")).toBe(true);
    expect(statuses.has("已打回")).toBe(true);
  });

  it("covers at least 3 modules", () => {
    const modules = new Set(requests.map((request) => request.module));

    expect(modules.size).toBeGreaterThanOrEqual(3);
  });

  it("uses valid createdAtTs ISO values at or before REVIEW_MOCK_NOW", () => {
    const now = new Date(REVIEW_MOCK_NOW).getTime();

    requests.forEach((request) => {
      const timestamp = new Date(request.createdAtTs).getTime();
      expect(Number.isNaN(timestamp)).toBe(false);
      expect(timestamp).toBeLessThanOrEqual(now);
    });
  });

  it("keeps waitingHours aligned with createdAtTs and REVIEW_MOCK_NOW", () => {
    const now = new Date(REVIEW_MOCK_NOW).getTime();

    requests.forEach((request) => {
      const expected = Math.floor((now - new Date(request.createdAtTs).getTime()) / 3_600_000);
      expect(request.waitingHours).toBe(expected);
    });
  });

  it("includes at least one request waiting 72h or more for SLA filtering demos", () => {
    expect(requests.some((request) => request.waitingHours >= 72)).toBe(true);
  });

  it("keeps aiSummary equal to aiSuggestion.summary for compatibility", () => {
    requests.forEach((request) => {
      expect(request.aiSummary).toBe(request.aiSuggestion.summary);
    });
  });
});
