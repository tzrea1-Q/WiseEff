import { describe, expect, it } from "vitest";

import { confidenceCaption } from "./confidenceProvenance";

describe("confidenceCaption", () => {
  it("labels agent confidence as an uncalibrated model self-estimate", () => {
    expect(confidenceCaption("agent", "AI置信度")).toBe("模型自估");
    expect(confidenceCaption("agent", "置信度")).toBe("模型自估");
  });

  it("labels rules-fallback confidence as a deterministic rules-engine score", () => {
    expect(confidenceCaption("rules-fallback", "AI置信度")).toBe("规则评分");
  });

  it("keeps the surface's existing caption for legacy reports without a source", () => {
    expect(confidenceCaption(null, "AI置信度")).toBe("AI置信度");
    expect(confidenceCaption(undefined, "置信度")).toBe("置信度");
  });
});
