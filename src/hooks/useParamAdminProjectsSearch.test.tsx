import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildParamAdminProjectsPath,
  parseParamAdminProjectsSearch,
  useParamAdminProjectsSearch
} from "./useParamAdminProjectsSearch";

afterEach(() => {
  window.history.replaceState(null, "", "/parameter-admin/projects");
});

describe("parameter-admin project list URL state", () => {
  it("normalizes invalid pages and resets pagination when filters change", () => {
    for (const page of ["0", "-2", "NaN", "Infinity", "1.5", "9007199254740992"]) {
      expect(parseParamAdminProjectsSearch(`?page=${page}`).page).toBe(1);
    }
    expect(buildParamAdminProjectsPath({ page: 3 })).toBe("/parameter-admin/projects?page=3");
    window.history.replaceState(null, "", "/parameter-admin/projects?page=3");
    const view = renderHook(() => useParamAdminProjectsSearch());
    act(() => view.result.current.updateSearch({ statuses: ["maintenance"] }));
    expect(window.location.search).toBe("?status=maintenance");
    expect(view.result.current.search.page).toBe(1);
  });
  it("parses and serializes the public q, status, and sort keys", () => {
    expect(
      parseParamAdminProjectsSearch("?q=aurora&status=maintenance,initialized&sort=updated-desc")
    ).toEqual({
      q: "aurora",
      statuses: ["maintenance", "initialized"],
      sort: "updated-desc",
      page: 1
    });
    expect(
      buildParamAdminProjectsPath({
        q: " aurora ",
        statuses: ["maintenance", "initialized"],
        sort: "updated-desc"
      })
    ).toBe("/parameter-admin/projects?q=aurora&status=maintenance%2Cinitialized&sort=updated-desc");
  });

  it("restores visible state after a reload-like remount and popstate", () => {
    window.history.replaceState(
      null,
      "",
      "/parameter-admin/projects?q=aurora&status=maintenance&sort=name-desc"
    );
    const first = renderHook(() => useParamAdminProjectsSearch());

    expect(first.result.current.search).toEqual({
      q: "aurora",
      statuses: ["maintenance"],
      sort: "name-desc",
      page: 1
    });

    act(() => first.result.current.updateSearch({ q: "beta" }));
    expect(window.location.search).toBe("?q=beta&status=maintenance&sort=name-desc");
    first.unmount();

    const reloaded = renderHook(() => useParamAdminProjectsSearch());
    expect(reloaded.result.current.search.q).toBe("beta");

    act(() => {
      window.history.replaceState(null, "", "/parameter-admin/projects?status=initialized&sort=updated-asc");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(reloaded.result.current.search).toEqual({
      q: "",
      statuses: ["initialized"],
      sort: "updated-asc",
      page: 1
    });
  });
});
