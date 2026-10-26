import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearTemplateHome } from "./LinearTemplateHome";

afterEach(cleanup);

describe("LinearTemplateHome workflow publication", () => {
  it("hides unpublished workflows across navigation, cards, previews, footer and promotional copy", () => {
    const { container } = render(
      <LinearTemplateHome onFeedback={vi.fn()} visibleWorkflows={["parameter-management", "debugging"]} />
    );

    expect(container).not.toHaveTextContent(/日志分析|知识库/);
    expect(container.querySelector('a[href^="/logs"], a[href^="/log-admin"], a[href^="/knowledge"]')).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "一条可审阅工作流，两种场景接入" })).toBeInTheDocument();
  });

  it("points generic workbench calls to action at a visible workflow", () => {
    const { container } = render(<LinearTemplateHome onFeedback={vi.fn()} visibleWorkflows={["debugging"]} />);

    expect(screen.getByRole("link", { name: "打开雷泽工作台" })).toHaveAttribute("href", "/node-debugging");
    expect(screen.getByRole("link", { name: "进入雷泽工作台" })).toHaveAttribute("href", "/node-debugging");
    expect(container.querySelector('a[href^="/parameter"]')).not.toBeInTheDocument();
  });

  it("removes stale entry links when publication changes to an empty list", () => {
    const { container, rerender } = render(<LinearTemplateHome onFeedback={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "知识库" })).toBeInTheDocument();

    rerender(<LinearTemplateHome onFeedback={vi.fn()} visibleWorkflows={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent("暂无向您开放的工作流");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /雷泽工作台/ })).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="/parameter"], a[href^="/node-debugging"], a[href^="/logs"], a[href^="/knowledge"]')).not.toBeInTheDocument();
  });
});
