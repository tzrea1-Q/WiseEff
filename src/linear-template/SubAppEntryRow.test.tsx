import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SubAppEntryRow } from "./SubAppEntryRow";

afterEach(cleanup);

describe("SubAppEntryRow", () => {
  it("renders allowlisted sub-app cards in the documented order", () => {
    render(<SubAppEntryRow />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["参数管理", "调试平台"]);
    expect(screen.queryByRole("heading", { name: "日志分析", level: 3 })).not.toBeInTheDocument();
  });

  it("does not show derived status badges on the entry cards", () => {
    render(<SubAppEntryRow />);

    expect(screen.queryByLabelText(/当前状态/)).not.toBeInTheDocument();
    expect(screen.queryByText("条待审阅")).not.toBeInTheDocument();
    expect(screen.queryByText("台样机在线")).not.toBeInTheDocument();
    expect(screen.queryByText("份已分析")).not.toBeInTheDocument();
  });

  it("shows the business positioning labels for all cards", () => {
    render(<SubAppEntryRow />);

    expect(screen.getByText("配置治理")).toBeInTheDocument();
    expect(screen.getByText("在线调试")).toBeInTheDocument();
    expect(screen.queryByText("证据链路")).not.toBeInTheDocument();
  });

  it("links the primary CTAs to the expected routes", () => {
    render(<SubAppEntryRow />);

    expect(screen.getByRole("link", { name: /进入参数首页/ })).toHaveAttribute("href", "/parameter-home");
    expect(screen.getByRole("link", { name: /进入节点调试/ })).toHaveAttribute("href", "/node-debugging");
    expect(screen.queryByRole("link", { name: /进入日志分析/ })).not.toBeInTheDocument();
  });

  it("links the secondary CTAs to the admin routes", () => {
    render(<SubAppEntryRow />);

    expect(screen.getByRole("link", { name: /打开参数管理后台/ })).toHaveAttribute("href", "/parameter-admin");
    expect(screen.getByRole("link", { name: /打开调试管理后台/ })).toHaveAttribute("href", "/debugging-admin");
    expect(screen.queryByRole("link", { name: /打开日志分析后台/ })).not.toBeInTheDocument();
  });

  it("applies the sub-app-entry-row container class", () => {
    const { container } = render(<SubAppEntryRow />);

    expect(container.querySelector(".sub-app-entry-row")).toBeInTheDocument();
    const cards = container.querySelectorAll(".sub-app-card");
    expect(cards).toHaveLength(2);
  });

  it("keeps the cards free of empty-state badge labels", () => {
    render(<SubAppEntryRow />);

    expect(screen.queryByText("暂无待办")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无记录")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无在线设备")).not.toBeInTheDocument();
  });
});
