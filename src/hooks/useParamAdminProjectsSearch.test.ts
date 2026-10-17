import { describe, expect, it } from "vitest";
import { resolveParamAdminProjectsReturnPath } from "./useParamAdminProjectsSearch";

describe("project list return context", () => {
  it("restores supported list filters and paging from a nested project route", () => {
    const returnTo = "/parameter-admin/projects?q=Aurora&status=maintenance&sort=updated-desc&page=2";
    expect(resolveParamAdminProjectsReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe(returnTo);
  });
  it.each(["https://example.com/parameter-admin/projects", "//example.com/parameter-admin/projects", "/parameters", "/parameter-admin/projects/other"])('refuses unrelated or external return target %s', (returnTo) => {
    expect(resolveParamAdminProjectsReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe("/parameter-admin/projects");
  });
});
