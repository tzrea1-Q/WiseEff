import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SpecRelatedKnowledgeSection } from "./ParameterSpecDetail";

afterEach(cleanup);

it("keeps knowledge references readable without entry or linking controls when no actions are supplied", async () => {
  const load = vi.fn(async () => [{ entryId: "knowledge-1", title: "调试参考", excerpt: "已发布的调试经验摘要。", updatedAt: "2026-10-23T00:00:00Z" }]);
  const view = render(<SpecRelatedKnowledgeSection specId="definition-1" source={{ load }} allowLink />);
  const section = within(screen.getByTestId("spec-related-knowledge"));
  expect(await section.findByText("调试参考")).toBeVisible();
  expect(section.getByText("已发布的调试经验摘要。")).toBeVisible();
  expect(section.queryByRole("button")).not.toBeInTheDocument();
  expect(section.queryByRole("link")).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledWith("definition-1");

  const onOpenEntry = vi.fn();
  view.rerender(<SpecRelatedKnowledgeSection specId="definition-1" source={{ load, onOpenEntry }} />);
  fireEvent.click(await section.findByRole("button", { name: /调试参考/ }));
  expect(onOpenEntry).toHaveBeenCalledWith("knowledge-1");
});
