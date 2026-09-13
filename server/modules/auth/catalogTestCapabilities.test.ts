import { describe, expect, it } from "vitest";

import { catalogTestCapabilitiesForUser } from "./catalogTestCapabilities";

describe("isolated catalog test capabilities", () => {
  it("does not grant catalog publication permissions by default", () => {
    expect(catalogTestCapabilitiesForUser("acceptance-role-admin", {})).toEqual([]);
  });

  it("overlays catalog capabilities for an explicit isolated principal only", () => {
    const env = {
      NODE_ENV: "test",
      AUTH_MODE: "development",
      WISEEFF_CATALOG_TEST_CAPABILITIES:
        "acceptance-role-admin:catalog:author,catalog:publish;u-zhao-heng:catalog:author"
    };
    expect(catalogTestCapabilitiesForUser("acceptance-role-admin", env)).toEqual([
      "catalog:author",
      "catalog:publish"
    ]);
    expect(catalogTestCapabilitiesForUser("u-zhao-heng", env)).toEqual(["catalog:author"]);
    expect(catalogTestCapabilitiesForUser("u-xu-yun", env)).toEqual([]);
  });

  it("does not overlay catalog:publish when AUTH_MODE is production", () => {
    expect(
      catalogTestCapabilitiesForUser("acceptance-role-admin", {
        NODE_ENV: "test",
        AUTH_MODE: "production",
        WISEEFF_CATALOG_TEST_CAPABILITIES: "acceptance-role-admin:catalog:author,catalog:publish"
      })
    ).toEqual([]);
  });

  it("does not overlay catalog:publish when NODE_ENV is production", () => {
    expect(
      catalogTestCapabilitiesForUser("acceptance-role-admin", {
        NODE_ENV: "production",
        AUTH_MODE: "development",
        WISEEFF_CATALOG_TEST_CAPABILITIES: "acceptance-role-admin:catalog:author,catalog:publish"
      })
    ).toEqual([]);
  });
});
