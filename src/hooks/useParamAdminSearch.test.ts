import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useParamAdminSearch } from "./useParamAdminSearch";

describe("useParamAdminSearch", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/parameter-admin");
  });

  it("reads default values", () => {
    const { result } = renderHook(() => useParamAdminSearch());

    expect(result.current.search.q).toBe("");
    expect(result.current.search.risk).toBe("all");
    expect(result.current.search.coverage).toBe("all");
    expect(result.current.search.modules).toEqual([]);
    expect(result.current.search.sort).toBe("updatedAt-desc");
    expect(result.current.search.id).toBeUndefined();
  });

  it("initializes from the URL", () => {
    window.history.replaceState(
      null,
      "",
      "/parameter-admin?q=charge&risk=high&module=charging-policy,battery-safety&coverage=orphan&sort=name-asc&id=p1&audit=open"
    );

    const { result } = renderHook(() => useParamAdminSearch());

    expect(result.current.search.q).toBe("charge");
    expect(result.current.search.risk).toBe("high");
    expect(result.current.search.modules).toEqual(["charging-policy", "battery-safety"]);
    expect(result.current.search.coverage).toBe("orphan");
    expect(result.current.search.sort).toBe("name-asc");
    expect(result.current.search.id).toBe("p1");
    expect(result.current.search.audit).toBe("open");
  });

  it("writes patch updates into the URL", () => {
    const { result } = renderHook(() => useParamAdminSearch());

    act(() => result.current.updateSearch({ risk: "high" }));

    expect(new URL(window.location.href).searchParams.get("risk")).toBe("high");
    expect(result.current.search.risk).toBe("high");
  });

  it("removes default values from the URL", () => {
    window.history.replaceState(null, "", "/parameter-admin?risk=high");
    const { result } = renderHook(() => useParamAdminSearch());

    act(() => result.current.updateSearch({ risk: "all" }));

    expect(new URL(window.location.href).searchParams.has("risk")).toBe(false);
  });

  it("serializes modules with commas", () => {
    const { result } = renderHook(() => useParamAdminSearch());

    act(() => result.current.updateSearch({ modules: ["a", "b"] }));

    expect(new URL(window.location.href).searchParams.get("module")).toBe("a,b");
  });
});
