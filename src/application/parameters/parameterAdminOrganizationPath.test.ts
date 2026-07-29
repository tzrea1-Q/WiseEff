import { describe, expect, it } from "vitest";

import {
  buildParameterAdminModulesPath,
  parseParameterAdminModulesSubView,
  parseParameterAdminOrganizationPath
} from "./parameterAdminOrganizationPath";

describe("parameterAdminOrganizationPath · modules sub-views", () => {
  it("maps modules, modules/queue, and modules/registry to the modules organization view", () => {
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules")).toBe("modules");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules/queue")).toBe("modules");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules/registry")).toBe("modules");
    expect(parseParameterAdminOrganizationPath("/parameter-admin/modules/other")).toBeNull();
  });

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
