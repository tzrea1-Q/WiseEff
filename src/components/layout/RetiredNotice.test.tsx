import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RetiredNotice } from "./RetiredNotice";

describe("RetiredNotice", () => {
  it("shows one explanation and a real primary replacement link that supports SPA navigation", () => {
    const onNavigate = vi.fn();
    render(<RetiredNotice title="页面不可用" description="独立页面已下线，请使用参数工作台。"
      actionLabel="参数工作台" actionPath="/parameters" onNavigate={onNavigate} />);
    const notice = screen.getByRole("region", { name: "页面不可用" });
    expect(within(notice).getByRole("heading", { name: "页面不可用" })).toBeInTheDocument();
    expect(within(notice).getByText("独立页面已下线，请使用参数工作台。")).toBeInTheDocument();
    expect(within(notice).queryByText("404")).not.toBeInTheDocument();
    const link = within(notice).getByRole("link", { name: "参数工作台" });
    expect(link).toHaveAttribute("href", "/parameters");
    expect(link).toHaveAttribute("data-variant", "default");
    fireEvent.click(link, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("/parameters");
  });
});
