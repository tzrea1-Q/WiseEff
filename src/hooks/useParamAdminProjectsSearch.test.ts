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
  it("preserves the chosen source and target when returning from project correction",()=>{
    const source="33333333-3333-4333-8333-333333333333",version="44444444-4444-4444-8444-444444444444";
    const params=new URLSearchParams({view:"projects",referenceResource:source,referenceVersion:version,referenceTargetProject:"project-a",referenceTargetConfig:"config-a",referenceReturn:"/parameter-admin/sources?resourceQuery=power&resourcePage=2"});
    const result=resolveSharedDtsiUsageReturnPath(`?returnTo=${encodeURIComponent(`/parameter-admin/sources?${params}`)}`);
    expect(result).not.toBeNull();const restored=new URL(result!,"http://localhost").searchParams;
    expect(restored.get("referenceResource")).toBe(source);expect(restored.get("referenceVersion")).toBe(version);expect(restored.get("referenceTargetProject")).toBe("project-a");expect(restored.get("referenceTargetConfig")).toBe("config-a");expect(restored.get("referenceReturn")).toBe("/parameter-admin/sources?resourceQuery=power&resourcePage=2");
  });
  it("restores the scoped usage view and supported filters", () => {
    const returnTo="/parameter-admin/sources?view=projects&organization=org-a&usageQuery=power&usageStatus=referenced&usagePage=2";
    expect(resolveSharedDtsiUsageReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe(returnTo);
  });
  it.each(["https://example.com/parameter-admin/sources?view=projects", "//example.com/parameter-admin/sources?view=projects", "/parameter-admin/sources?view=resources", "/parameter-admin/sources?view=projects#other"])("rejects unrelated targets: %s",returnTo=>{
    expect(resolveSharedDtsiUsageReturnPath(`?returnTo=${encodeURIComponent(returnTo)}`)).toBeNull();
  });
});
