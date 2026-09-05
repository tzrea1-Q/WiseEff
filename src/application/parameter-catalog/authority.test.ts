import { describe, expect, it } from "vitest";

import {
  catalogActionsForActor,
  catalogActorForRole,
  catalogActorForSession,
  isCatalogActionEnabled,
  isCatalogAgentPrincipal
} from "./authority";
import { catalogWritesEnabled, deriveCatalogDomainState } from "./states";
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
    expect(isCatalogActionEnabled("org-admin", "resolve-review-item", unregistered)).toBe(true);
    expect(isCatalogActionEnabled("org-admin", "read", unregistered)).toBe(true);
    expect(isCatalogActionEnabled("org-admin", "update-placement", unregistered)).toBe(false);
    expect(catalogWritesEnabled(unregistered)).toBe(false);
    expect(isCatalogActionEnabled("org-admin", "accept-proposal", ready)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "register-subject", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "resolve-review-item", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "accept-proposal", ready)).toBe(true);
    expect(isCatalogActionEnabled("user", "register-subject", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("user", "resolve-review-item", unregistered)).toBe(false);
    expect(isCatalogActionEnabled("user", "create-proposal", ready)).toBe(true);
  });

  it("maps live platform roles onto Catalog actors", () => {
    expect(catalogActorForRole("admin")).toBe("org-admin");
    expect(catalogActorForRole("platform-admin")).toBe("platform-admin");
    expect(catalogActorForRole("hardware-user")).toBe("user");
    expect(catalogActorForRole("software-committer")).toBe("user");
  });

  it("maps WiseEff Agent principals onto the read-only Catalog actor", () => {
    expect(isCatalogAgentPrincipal({ title: "WiseEff Agent" })).toBe(true);
    expect(isCatalogAgentPrincipal({ userId: "agt-catalog-acceptance" })).toBe(true);
    expect(catalogActorForSession({ roleId: "admin", userId: "agt-catalog-acceptance" })).toBe("agent");
    expect(catalogActorForSession({ roleId: "guest", title: "WiseEff Agent" })).toBe("agent");
    expect(catalogActorForSession({ roleId: "admin", userId: "acceptance-role-admin" })).toBe("org-admin");
  });

  it("disables mutations while loading even when a previous release is visible", () => {
    expect(isCatalogActionEnabled("org-admin", "read", loading)).toBe(true);
    expect(isCatalogActionEnabled("org-admin", "resolve-review-item", loading)).toBe(false);
    expect(isCatalogActionEnabled("org-admin", "register-subject", loading)).toBe(false);
    expect(isCatalogActionEnabled("platform-admin", "accept-proposal", loading)).toBe(false);
  });
});
