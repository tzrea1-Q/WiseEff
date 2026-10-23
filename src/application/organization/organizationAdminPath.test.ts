import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_ADMIN_MEMBERS_PATH,
  ORGANIZATION_ADMIN_BRIDGES_PATH,
  ORGANIZATION_ADMIN_PATH,
  buildOrganizationAdminPath,
  isOrganizationAdminPath,
  parseOrganizationAdminArea
} from "./organizationAdminPath";

describe("organizationAdminPath", () => {
  it("treats profile and members as scope peers of one admin surface", () => {
    expect(isOrganizationAdminPath(ORGANIZATION_ADMIN_PATH)).toBe(true);
    expect(isOrganizationAdminPath(ORGANIZATION_ADMIN_MEMBERS_PATH)).toBe(true);
    expect(isOrganizationAdminPath("/user-permissions")).toBe(true);
    expect(isOrganizationAdminPath("/parameter-admin")).toBe(false);

    expect(parseOrganizationAdminArea(ORGANIZATION_ADMIN_PATH)).toBe("profile");
    expect(parseOrganizationAdminArea(ORGANIZATION_ADMIN_MEMBERS_PATH)).toBe("members");
    expect(parseOrganizationAdminArea("/user-permissions")).toBe("members");
    expect(buildOrganizationAdminPath("profile")).toBe(ORGANIZATION_ADMIN_PATH);
    expect(buildOrganizationAdminPath("members")).toBe(ORGANIZATION_ADMIN_MEMBERS_PATH);
    expect(parseOrganizationAdminArea(ORGANIZATION_ADMIN_BRIDGES_PATH)).toBe("bridges");
    expect(buildOrganizationAdminPath("bridges")).toBe(ORGANIZATION_ADMIN_BRIDGES_PATH);
    expect(parseOrganizationAdminArea("/organization/integrations")).toBe("integrations");
    expect(buildOrganizationAdminPath("integrations")).toBe("/organization/integrations");
    expect(parseOrganizationAdminArea("/organization/projects")).toBe("projects");
    expect(buildOrganizationAdminPath("projects")).toBe("/organization/projects");
  });
});
