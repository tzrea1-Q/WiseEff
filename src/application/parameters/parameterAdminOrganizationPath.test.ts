import { describe, expect, it } from "vitest";

import {
  buildParameterAdminModulesPath,
  buildParameterAdminOrganizationPath,
  buildParameterAdminSpecsPath,
  parseParameterAdminModulesSubView,
  parseParameterAdminOrganizationPath,
  parseParameterAdminSpecsSubView,
  resolveParameterAdminOrganizationRedirect
} from "./parameterAdminOrganizationPath";

describe("parameterAdminOrganizationPath · organization peers", () => {
  it("maps specs and nested identity-mapping to the specs organization view", () => {
    expect(parseParameterAdminOrganizationPath("/parameter-admin/specs")).toBe("specs");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/specs/identity-mapping")).toBe(
      "specs"
    );
    expect(parseParameterAdminOrganizationPath("/parameter-admin/specs/other")).toBeNull();
  });

  it("maps modules, modules/queue, and modules/registry to the modules organization view", () => {
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules")).toBe("modules");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules/queue")).toBe("modules");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules/registry")).toBe("modules");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules/other")).toBeNull();
  });

  it("does not treat retired peer routes as organization views", () => {
    expect(parseParameterAdminOrganizationPath("/parameter-admin/spec-review")).toBeNull();
    expect(parseParameterAdminOrganizationPath("/parameter-admin/identity-mapping")).toBeNull();
  });

  it("builds organization peer paths", () => {
    expect(buildParameterAdminOrganizationPath("specs")).toBe("/parameter-admin/specs");
    expect(buildParameterAdminOrganizationPath("modules", "?q=1")).toBe(
      "/parameter-admin/modules?q=1"
    );
  });
});

describe("parameterAdminOrganizationPath · specs sub-views", () => {
  it("distinguishes library and identity-mapping", () => {
    expect(parseParameterAdminSpecsSubView("/parameter-admin/specs")).toBe("library");
    expect(parseParameterAdminSpecsSubView("/parameter-admin/specs/")).toBe("library");
    expect(parseParameterAdminSpecsSubView("/parameter-admin/specs/identity-mapping")).toBe(
      "identity-mapping"
    );
    expect(parseParameterAdminSpecsSubView("/parameter-admin/modules")).toBeNull();
  });

  it("builds specs paths", () => {
    expect(buildParameterAdminSpecsPath("library")).toBe("/parameter-admin/specs");
    expect(buildParameterAdminSpecsPath("identity-mapping", "q=gpio")).toBe(
      "/parameter-admin/specs/identity-mapping?q=gpio"
    );
  });
});

describe("parameterAdminOrganizationPath · modules sub-views", () => {
  it("distinguishes tree and queue; legacy registry path falls back to tree", () => {
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/queue")).toBe("queue");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/registry")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/specs")).toBeNull();
  });

  it("builds modules paths", () => {
    expect(buildParameterAdminModulesPath("tree")).toBe("/parameter-admin/modules");
    expect(buildParameterAdminModulesPath("queue", "?audit=1")).toBe(
      "/parameter-admin/modules/queue?audit=1"
    );
  });
});

describe("parameterAdminOrganizationPath · legacy redirects", () => {
  it("redirects retired peer routes while preserving query strings", () => {
    expect(resolveParameterAdminOrganizationRedirect("/parameter-admin/spec-review")).toBe(
      "/parameter-admin/specs"
    );
    expect(
      resolveParameterAdminOrganizationRedirect("/parameter-admin/spec-review", "?q=gpio")
    ).toBe("/parameter-admin/specs?q=gpio");
    expect(resolveParameterAdminOrganizationRedirect("/parameter-admin/identity-mapping")).toBe(
      "/parameter-admin/specs/identity-mapping"
    );
    expect(
      resolveParameterAdminOrganizationRedirect("/parameter-admin/identity-mapping", "status=open")
    ).toBe("/parameter-admin/specs/identity-mapping?status=open");
    expect(resolveParameterAdminOrganizationRedirect("/parameter-admin/specs")).toBeNull();
  });
});
