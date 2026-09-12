import { describe, expect, it } from "vitest";

import { classifyImpact, lowRiskCreateDefinitionFacts } from "./classify";
import { CATALOG_PUBLICATION_LOCK_ORDER } from "./types";
import type { ImpactFacts } from "./types";

const author = "user-catalog-author";

describe("catalog publication impact classification", () => {
  it("classifies supported create-definition with no matcher or contract change as low", () => {
    expect(classifyImpact(lowRiskCreateDefinitionFacts(author))).toEqual({
      ok: true,
      value: "low",
    });
  });

  it("does not treat vendor or repository source as low by itself", () => {
    const vendor = lowRiskCreateDefinitionFacts(author, "vendor-yaml");
    const repository = lowRiskCreateDefinitionFacts(author, "repository-bundle");
    expect(classifyImpact(vendor)).toEqual({ ok: true, value: "low" });
    expect(classifyImpact(repository)).toEqual({ ok: true, value: "low" });
    expect(
      classifyImpact({
        ...vendor,
        introducesNewSubject: true,
        operations: [{ op: "create-subject-with-definitions" }],
      }),
    ).toEqual({ ok: true, value: "high" });
  });

  it("classifies new subject, selector, alias, fallback, tightening, unit, and retirement as high", () => {
    const cases: ImpactFacts[] = [
      { ...lowRiskCreateDefinitionFacts(author), introducesNewSubject: true },
      { ...lowRiskCreateDefinitionFacts(author), changesSelector: true },
      { ...lowRiskCreateDefinitionFacts(author), changesAlias: true },
      { ...lowRiskCreateDefinitionFacts(author), changesFallback: true },
      { ...lowRiskCreateDefinitionFacts(author), tightensExistingContract: true },
      { ...lowRiskCreateDefinitionFacts(author), changesUnitOrSemantic: true },
      { ...lowRiskCreateDefinitionFacts(author), retiresIdentity: true },
      {
        ...lowRiskCreateDefinitionFacts(author),
        operations: [{ op: "revise-definition", class: "semantic" }],
      },
    ];
    for (const facts of cases) {
      expect(classifyImpact(facts), JSON.stringify(facts)).toEqual({ ok: true, value: "high" });
    }
  });

  it("blocks unknown impact instead of downgrading because a client claimed low", () => {
    expect(
      classifyImpact({
        ...lowRiskCreateDefinitionFacts(author),
        unknownImpact: true,
      }),
    ).toEqual({
      ok: false,
      error: {
        reason: "unsupported-catalog-capability",
        detail: "unknown impact cannot be classified as low or approved as high",
      },
    });
    expect(
      classifyImpact({
        ...lowRiskCreateDefinitionFacts(author),
        operations: [{ op: "unknown", tag: "rename-property" }],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "unsupported-catalog-capability" },
    });
    expect(
      classifyImpact({
        ...lowRiskCreateDefinitionFacts(author),
        operations: [{ op: "create-definition", supported: false }],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "unsupported-catalog-capability" },
    });
  });

  it("documents CP-05 lock order as catalog exclusive then publication guard", () => {
    expect(CATALOG_PUBLICATION_LOCK_ORDER).toEqual([
      "parameter_catalog.acquire_current_pointer_lock_exclusive()",
      "catalog_publication.acquire_publication_guard_lock()",
    ]);
  });
});
