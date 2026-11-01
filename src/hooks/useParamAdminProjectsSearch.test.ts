import { describe, expect, it } from "vitest";
import { resolveParamAdminProjectsReturnPath, resolveSharedDtsiUsageReturnPath } from "./useParamAdminProjectsSearch";

describe("project list return context", () => {
  it("restores supported list filters and paging from a nested project route", () => {
    const returnTo = "/parameter-admin/projects?q=Aurora&status=maintenance&sort=updated-desc&page=2";
    expect(resolveParamAdminProjectsReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe(returnTo);
  });
  it.each(["https://example.com/parameter-admin/projects", "//example.com/parameter-admin/projects", "/parameters", "/parameter-admin/projects/other"])('refuses unrelated or external return target %s', (returnTo) => {
    expect(resolveParamAdminProjectsReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe("/parameter-admin/projects");
  });
});

describe("shared DTSI usage return context", () => {
  it("restores the scoped usage view and supported filters", () => {
    const returnTo="/parameter-admin/sources?view=projects&organization=org-a&usageQuery=power&usageStatus=referenced&usagePage=2";
    expect(resolveSharedDtsiUsageReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe(returnTo);
  });
  it.each(["https://example.com/parameter-admin/sources?view=projects", "//example.com/parameter-admin/sources?view=projects", "/parameter-admin/sources?view=resources", "/parameter-admin/sources?view=projects#other"])("rejects unrelated targets: %s",returnTo=>{
    expect(resolveSharedDtsiUsageReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBeNull();
  });
});
