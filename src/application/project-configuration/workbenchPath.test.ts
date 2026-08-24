import { describe, expect, it } from "vitest";
import { isProjectConfigurationWorkbenchPath } from "./workbenchPath";

describe("isProjectConfigurationWorkbenchPath", () => {
  it.each([
    "/parameter-admin/projects/project-1/configuration",
    "/parameter-admin/projects/project-1/configuration/"
  ])("recognizes a full-height project configuration workbench path: %s", (pathname) => {
    expect(isProjectConfigurationWorkbenchPath(pathname)).toBe(true);
  });

  it.each([
    "/parameter-admin/projects",
    "/parameter-admin/projects/project-1",
    "/parameter-admin/projects/project-1/configuration/history",
    "/parameters"
  ])("does not classify a normal application page as a workbench: %s", (pathname) => {
    expect(isProjectConfigurationWorkbenchPath(pathname)).toBe(false);
  });
});
