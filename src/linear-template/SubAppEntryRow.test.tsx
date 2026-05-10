import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialState } from "../mockData";
import { SubAppEntryRow } from "./SubAppEntryRow";

afterEach(cleanup);

describe("SubAppEntryRow", () => {
  it("renders three sub-app cards in the documented order", () => {
    render(<SubAppEntryRow state={initialState} />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["参数管理", "日志分析", "参数调试"]);
  });

  it("uses the badges derived from initial mock state", () => {
    render(<SubAppEntryRow state={initialState} />);

    expect(screen.getByLabelText("1 条待审阅")).toBeInTheDocument();
    expect(screen.getByLabelText("已分析 1 份")).toBeInTheDocument();
    expect(screen.getByLabelText("1 台样机在线")).toBeInTheDocument();
  });

  it("links the primary CTAs to the expected routes", () => {
    render(<SubAppEntryRow state={initialState} />);

    expect(screen.getByRole("link", { name: /进入参数首页/ })).toHaveAttribute("href", "/parameter-home");
    expect(screen.getByRole("link", { name: /进入日志分析/ })).toHaveAttribute("href", "/logs");
    expect(screen.getByRole("link", { name: /进入调试工作台/ })).toHaveAttribute("href", "/debugging");
  });

  it("links the secondary CTAs to the admin routes", () => {
    render(<SubAppEntryRow state={initialState} />);

    expect(screen.getByRole("link", { name: /打开参数管理后台/ })).toHaveAttribute("href", "/parameter-admin");
    expect(screen.getByRole("link", { name: /打开日志分析后台/ })).toHaveAttribute("href", "/log-admin");
    expect(screen.getByRole("link", { name: /打开调试管理后台/ })).toHaveAttribute("href", "/debugging-admin");
  });

  it("applies the sub-app-entry-row container class", () => {
    const { container } = render(<SubAppEntryRow state={initialState} />);

    expect(container.querySelector(".sub-app-entry-row")).toBeInTheDocument();
    const cards = container.querySelectorAll(".sub-app-card");
    expect(cards).toHaveLength(3);
  });

  it("renders empty-state badges when counts are zero", () => {
    const emptyState = { ...initialState, parameterSubmissionRounds: [], logs: [], devices: [] };

    render(<SubAppEntryRow state={emptyState} />);

    expect(screen.getByLabelText("暂无待办")).toBeInTheDocument();
    expect(screen.getByLabelText("暂无记录")).toBeInTheDocument();
    expect(screen.getByLabelText("暂无在线设备")).toBeInTheDocument();
  });
});
