import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialState } from "./mockData";
import { renderApp } from "./test/harness";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("app shell skip-link and landmarks", () => {
  it("exposes a skip link to the labelled main landmark on /parameter-review", () => {
    window.history.replaceState(null, "", "/parameter-review");
    renderApp({ initialAppState: { ...initialState, activeRoleId: "admin" }, runtimeMode: "mock" });

    const skip = screen.getByRole("link", { name: "跳到主内容" });
    expect(skip).toHaveAttribute("href", "#main-content");
    const main = screen.getByRole("main", { name: "参数管理员工作台" });
    expect(main).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("banner", { name: "页面栏" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });
});
