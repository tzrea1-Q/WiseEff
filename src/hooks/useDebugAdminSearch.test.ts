import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { parseDebugAdminSearch, useDebugAdminSearch } from "./useDebugAdminSearch";

describe("parseDebugAdminSearch", () => {
  it("parses query string values", () => {
    expect(
      parseDebugAdminSearch(
        "?q=charge&risk=high&module=charging-policy,battery-safety&coverage=dual&sort=risk-desc&id=p1"
      )
    ).toEqual({
      q: "charge",
      risk: "high",
      modules: ["charging-policy", "battery-safety"],
      coverage: "dual",
      sort: "risk-desc",
      id: "p1"
    });
  });

  it("falls back to defaults for invalid values", () => {
    expect(parseDebugAdminSearch("?risk=unknown&coverage=invalid")).toEqual({
      q: "",
      risk: "all",
      modules: [],
      coverage: "all",
      sort: "name-asc",
      id: undefined
    });
  });
});

describe("useDebugAdminSearch", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/debugging-admin");
  });

  it("reads default values", () => {
    const { result } = renderHook(() => useDebugAdminSearch());

    expect(result.current.search.q).toBe("");
    expect(result.current.search.risk).toBe("all");
    expect(result.current.search.coverage).toBe("all");
    expect(result.current.search.modules).toEqual([]);
    expect(result.current.search.sort).toBe("name-asc");
    expect(result.current.search.id).toBeUndefined();
  });

  it("initializes from the URL", () => {
    window.history.replaceState(
      null,
      "",
      "/debugging-admin?q=charge&risk=high&module=Battery,Device%20Lab&coverage=hdc-only&sort=risk-desc&id=p1"
    );

    const { result } = renderHook(() => useDebugAdminSearch());

    expect(result.current.search.q).toBe("charge");
    expect(result.current.search.risk).toBe("high");
    expect(result.current.search.modules).toEqual(["Battery", "Device Lab"]);
    expect(result.current.search.coverage).toBe("hdc-only");
    expect(result.current.search.sort).toBe("risk-desc");
    expect(result.current.search.id).toBe("p1");
  });

  it("writes patch updates into the URL", () => {
    const { result } = renderHook(() => useDebugAdminSearch());

    act(() => result.current.updateSearch({ risk: "high" }));

    expect(new URL(window.location.href).searchParams.get("risk")).toBe("high");
    expect(result.current.search.risk).toBe("high");
  });

  it("removes default values from the URL", () => {
    window.history.replaceState(null, "", "/debugging-admin?risk=high&sort=risk-desc");
    const { result } = renderHook(() => useDebugAdminSearch());

    act(() => result.current.updateSearch({ risk: "all", sort: "name-asc" }));

    const params = new URL(window.location.href).searchParams;
    expect(params.has("risk")).toBe(false);
    expect(params.has("sort")).toBe(false);
  });

  it("serializes modules with commas", () => {
    const { result } = renderHook(() => useDebugAdminSearch());

    act(() => result.current.updateSearch({ modules: ["a", "b"] }));

    expect(new URL(window.location.href).searchParams.get("module")).toBe("a,b");
  });
});
