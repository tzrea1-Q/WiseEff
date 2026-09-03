import { describe, expect, it } from "vitest";

import { catalogActionsForActor, isCatalogActionEnabled } from "./authority";
import { deriveCatalogDomainState } from "./states";
import { readyCatalogDocument, unregisteredSubject } from "./fixtures";

describe("catalog actor authority", () => {
  const ready = deriveCatalogDomainState({ document: readyCatalogDocument });
  const unregistered = deriveCatalogDomainState({
    document: readyCatalogDocument,
    subject: unregisteredSubject
  });
  const loading = deriveCatalogDomainState({
    inFlight: true,
    previousReleaseId: readyCatalogDocument.item.catalogReleaseId
  });

  it("keeps Agent read-only in every closed state", () => {
    expect([...catalogActionsForActor("agent")]).toEqual(["read"]);
    expect(isCatalogActionEnabled("agent", "read", ready)).toBe(true);
    expect(isCatalogActionEnabled("agent", "register-subject", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("agent", "resolve-review-item", ready)).toBe(false);
    expect(isCatalogActionEnabled("agent", "accept-proposal", ready)).toBe(false);
  });

  it("separates Org Admin registration from Platform Admin proposal review", () => {
    expect(isCatalogActionEnabled("org-admin", "register-subject", unregistered)).toBe(true);
    expect(isCatalogActionEnabled("org-admin", "accept-proposal", ready)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "register-subject", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "accept-proposal", ready)).toBe(true);
    expect(isCatalogActionEnabled("user", "register-subject", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("user", "create-proposal", ready)).toBe(true);
  });

  it("disables mutations while loading even when a previous release is visible", () => {
    expect(isCatalogActionEnabled("org-admin", "read", loading)).toBe(true);
    expect(isCatalogActionEnabled("org-admin", "resolve-review-item", loading)).toBe(false);
    expect(isCatalogActionEnabled("org-admin", "register-subject", loading)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "accept-proposal", loading)).toBe(false);
  });
});
