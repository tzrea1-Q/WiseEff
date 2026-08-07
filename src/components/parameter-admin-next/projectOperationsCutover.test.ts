import { describe, expect, it } from "vitest";
import {
  LEGACY_PROJECT_OPERATION_VIEWS,
  buildCanonicalConfigurationPath,
  isLegacyProjectOperationView
} from "./projectOperationsCutover";

describe("projectOperationsCutover", () => {
  it("exposes the four legacy project-operation views", () => {
    expect(LEGACY_PROJECT_OPERATION_VIEWS).toEqual([
      "files",
      "config-sets",
      "structure",
      "conflicts"
    ]);
  });

  it("detects legacy views and rejects configuration / unknown", () => {
    expect(isLegacyProjectOperationView("files")).toBe(true);
    expect(isLegacyProjectOperationView("config-sets")).toBe(true);
    expect(isLegacyProjectOperationView("structure")).toBe(true);
    expect(isLegacyProjectOperationView("conflicts")).toBe(true);
    expect(isLegacyProjectOperationView("configuration")).toBe(false);
    expect(isLegacyProjectOperationView(null)).toBe(false);
    expect(isLegacyProjectOperationView(undefined)).toBe(false);
    expect(isLegacyProjectOperationView("other")).toBe(false);
  });

  it("maps files to inspector=file and preserves focus query params", () => {
    expect(buildCanonicalConfigurationPath("proj-1", "files")).toBe(
      "/parameter-admin/projects/proj-1/configuration?inspector=file"
    );
    expect(
      buildCanonicalConfigurationPath(
        "proj-1",
        "files",
        "?file=f1&node=soc/gpio&property=reg&q=gpio&noise=drop"
      )
    ).toBe(
      "/parameter-admin/projects/proj-1/configuration?file=f1&node=soc%2Fgpio&property=reg&q=gpio&inspector=file"
    );
  });

  it("maps config-sets to inspector=config-set and preserves configSet", () => {
    expect(
      buildCanonicalConfigurationPath("proj-1", "config-sets", "?configSet=cs-default")
    ).toBe(
      "/parameter-admin/projects/proj-1/configuration?configSet=cs-default&inspector=config-set"
    );
  });

  it("maps structure to configuration with working source mode by default", () => {
    expect(buildCanonicalConfigurationPath("proj-1", "structure")).toBe(
      "/parameter-admin/projects/proj-1/configuration?sourceMode=working"
    );
    expect(
      buildCanonicalConfigurationPath(
        "proj-1",
        "structure",
        "?file=f1&node=board&property=model&sourceMode=structured"
      )
    ).toBe(
      "/parameter-admin/projects/proj-1/configuration?file=f1&node=board&property=model&sourceMode=structured"
    );
  });

  it("maps conflicts to tasks=conflicts", () => {
    expect(buildCanonicalConfigurationPath("proj-1", "conflicts")).toBe(
      "/parameter-admin/projects/proj-1/configuration?tasks=conflicts"
    );
    expect(buildCanonicalConfigurationPath("proj-1", "conflicts", "?file=f1")).toBe(
      "/parameter-admin/projects/proj-1/configuration?file=f1&tasks=conflicts"
    );
  });

  it("encodes project ids in the canonical path", () => {
    expect(buildCanonicalConfigurationPath("proj/with space", "files")).toBe(
      "/parameter-admin/projects/proj%2Fwith%20space/configuration?inspector=file"
    );
  });
});
