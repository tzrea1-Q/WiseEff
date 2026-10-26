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
  it("recognizes the shared source library without inventing nested source routes", () => {
    expect(parseParameterAdminOrganizationPath("/parameter-admin/sources")).toBe("sources");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/sources/other")).toBeNull();
    expect(buildParameterAdminOrganizationPath("sources", "resource=draft")).toBe("/parameter-admin/sources?resource=draft");
  });
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
  it("resolves URL-backed tabs and preserves old queue and registry bookmarks", () => {
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/queue")).toBe("queue");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/registry")).toBe("registry");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules", "?tab=queue")).toBe("queue");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules", "?tab=registry")).toBe("registry");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules", "?tab=modules")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules", "?tab=unknown")).toBe("tree");
    expect(parseParameterAdminModulesSubView("/parameter-admin/modules/queue", "?tab=registry")).toBe("queue");
    expect(parseParameterAdminModulesSubView("/parameter-admin/specs")).toBeNull();
  });

  it("builds modules paths", () => {
    expect(buildParameterAdminModulesPath("tree")).toBe("/parameter-admin/modules");
    expect(buildParameterAdminModulesPath("queue", "?audit=1")).toBe(
      "/parameter-admin/modules?audit=1&tab=queue"
    );
    expect(buildParameterAdminModulesPath("registry", "?q=driver&tab=queue")).toBe(
      "/parameter-admin/modules?q=driver&tab=registry"
    );
    expect(buildParameterAdminModulesPath("tree", "?q=driver&tab=registry")).toBe(
      "/parameter-admin/modules?q=driver"
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
