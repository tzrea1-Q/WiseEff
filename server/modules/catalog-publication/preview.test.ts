import { describe, expect, it } from "vitest";

import { integerContent } from "./builder/predecessorHarness";
import type { CatalogImpactReport } from "./builder/types";
import { parsePublicationChangeSet, publicationImpactFacts } from "./preview";

const emptyImpact = (overrides: Partial<CatalogImpactReport> = {}): CatalogImpactReport => ({
  schemaVersion: "catalog-impact/v1",
  predecessor: { releaseId: "crel_a", digest: "sha256:" + "a".repeat(64) },
  successor: { releaseId: "crel_b", digest: "sha256:" + "b".repeat(64) },
  definitions: { added: [], changed: [], unchanged: [] },
  subjects: { added: [], changed: [], unchanged: [] },
  aliases: { added: [], changed: [], unchanged: [] },
  selectors: { added: [], changed: [], removed: [] },
  matcher: {
    existingMatchRulesChanged: false,
    fallbackImpact: false,
    newMatchableProperties: [],
  },
  existingContractsTighten: false,
  capabilityContractRevision: "catalog-capability/v1",
  ...overrides,
});

describe("publication M2 preview parse and facts", () => {
  it("parses create-subject-with-definitions and revise-definition on the frozen routes", () => {
    const parsed = parsePublicationChangeSet([
      {
        op: "create-subject-with-definitions",
        kind: "driver",
        canonicalKey: "driver:acme,aux",
        selector: { kind: "driver-compatible", value: "acme,aux" },
        nature: "physical-device",
        cardinality: "multiple",
        definitions: [{ propertyKey: "vbat", content: integerContent("Aux", "Aux voltage.") }],
      },
    ]);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed[0]?.op).toBe("create-subject-with-definitions");
  });

  it("rejects nested definitions that include a published subjectId", () => {
    const parsed = parsePublicationChangeSet([
      {
        op: "create-subject-with-definitions",
        kind: "driver",
        canonicalKey: "driver:acme,aux",
        selector: { kind: "driver-compatible", value: "acme,aux" },
        definitions: [
          {
            subjectId: "csub_acme_power",
            propertyKey: "vbat",
            content: integerContent("Aux", "Aux voltage."),
          },
        ],
      },
    ]);
    expect(parsed).toMatchObject({ error: { kind: "invalid-input", reason: "changeSet" } });
  });

  it("persists backend-confirmed class rather than the client documentation label", () => {
    const facts = publicationImpactFacts(
      "user-author",
      [
        {
          op: "revise-definition",
          definitionId: "pdef_acme_power_iin_max",
          class: "documentation",
          content: integerContent("Input current limit", "docs"),
        },
      ],
      emptyImpact({
        definitions: {
          added: [],
          unchanged: [],
          changed: [
            {
              definitionId: "pdef_acme_power_iin_max",
              subjectId: "csub_acme_power",
              propertyKey: "iin_max",
              revisionId: "drev_2",
              previousRevisionId: "drev_1",
              contentClass: "semantic",
              requestedClass: "documentation",
            },
          ],
        },
        existingContractsTighten: true,
      }),
    );
    expect(facts.operations).toEqual([{ op: "revise-definition", class: "semantic" }]);
    expect(facts.changesUnitOrSemantic).toBe(true);
    expect(facts.tightensExistingContract).toBe(true);
    expect(facts.introducesNewSubject).toBe(false);
  });

  it("marks new subject, selector, and fallback as high-impact facts without synthesizing low", () => {
    const facts = publicationImpactFacts(
      "user-author",
      [
        {
          op: "create-subject-with-definitions",
          kind: "driver",
          canonicalKey: "driver:acme,aux",
          selector: { kind: "driver-compatible", value: "acme,aux" },
          nature: "physical-device",
          cardinality: "multiple",
          definitions: [{ propertyKey: "vbat", content: integerContent("Aux", "Aux voltage.") }],
        },
      ],
      emptyImpact({
        subjects: { added: ["csub_acme_aux"], changed: [], unchanged: [] },
        selectors: { added: ["acme,aux"], changed: [], removed: [] },
        matcher: {
          existingMatchRulesChanged: false,
          fallbackImpact: true,
          newMatchableProperties: [
            {
              subjectId: "csub_acme_aux",
              propertyKey: "vbat",
              sourceProperty: "vbat",
              selectorKind: "driver-compatible",
            },
          ],
        },
      }),
    );
    expect(facts.introducesNewSubject).toBe(true);
    expect(facts.changesSelector).toBe(true);
    expect(facts.changesFallback).toBe(true);
    expect(facts.operations).toEqual([{ op: "create-subject-with-definitions" }]);
  });
});
