import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeExtractionBadge } from "./badges";

describe("KnowledgeExtractionBadge", () => {
  it("replaces internal extraction errors with product copy", () => {
    render(<KnowledgeExtractionBadge status="failed" error="ENOENT /srv/knowledge/extractor.js" />);
    expect(screen.getByText("提取失败")).toHaveAttribute("title", "服务暂时不可用，请稍后重试。");
  });
});
