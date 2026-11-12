import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialState } from "./mockData";
import { renderApp } from "./test/harness";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("app shell skip-link and landmarks", () => {
  it("exposes a skip link to the change center after normalizing the old review route", () => {
    window.history.replaceState(null, "", "/parameter-review");
    renderApp({ initialAppState: { ...initialState, activeRoleId: "admin" }, runtimeMode: "mock" });

    const skip = screen.getByRole("link", { name: "跳到主内容" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(window.location.pathname).toBe("/parameter-changes");
    expect(new URLSearchParams(window.location.search).get("scope")).toBe("review");
    const main = screen.getByRole("main", { name: "变更中心" });
    expect(main).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("banner", { name: "页面栏" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });
});
