import { describe, expect, it } from "vitest";

import {
  CLASSIFIER_RULE_IDS,
  CLASSIFIER_VERSION,
  DISPOSITION_BY_R_CLASS,
  SAME_KEY_R6_R8_PROPERTY_KEY,
  classifyFrozenP0Graph,
  fingerprintP0Graph,
} from "./index";
import {
  EXPECTED_P0_CLASS_BY_IDENTITY,
  FROZEN_P0_GRAPH_FIXTURE,
  FROZEN_P0_GRAPH_SHA256,
} from "./__fixtures__/p0GraphFixture";
import { R_CLASSES } from "./types";

const classifiedFixture = () => {
  const result = classifyFrozenP0Graph(FROZEN_P0_GRAPH_FIXTURE);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
};

describe("full-graph legacy classifier", () => {
  it("assigns every R0-R10 class exactly once per source identity", () => {
    const result = classifiedFixture();
    const byId = Object.fromEntries(
      result.assignments.map((assignment) => [assignment.identityId, assignment.rClass]),
    );
    expect(byId).toEqual(EXPECTED_P0_CLASS_BY_IDENTITY);
    expect(new Set(result.assignments.map((assignment) => assignment.rClass))).toEqual(
      new Set(R_CLASSES),
    );
    expect(result.classifierVersion).toBe(CLASSIFIER_VERSION);
    expect(result.assignments.every((assignment) => assignment.ruleId === CLASSIFIER_RULE_IDS[assignment.rClass])).toBe(
      true,
    );
  });

  it("conserves the frozen P0 graph with no duplicate primary dispositions", () => {
    const result = classifiedFixture();
    expect(result.conservation.inputCount).toBe(FROZEN_P0_GRAPH_FIXTURE.identities.length);
    expect(result.conservation.classifiedCount).toBe(result.conservation.inputCount);
    expect(result.conservation.duplicatePrimaryCount).toBe(0);
    expect(result.conservation.conserved).toBe(true);
    expect(result.assignments).toHaveLength(result.conservation.inputCount);
    expect(new Set(result.assignments.map((assignment) => assignment.identityId)).size).toBe(
      result.conservation.inputCount,
    );
  });

  it("does not classify a platform spec as R0 solely because an organization binds it", () => {
    const result = classifiedFixture();
    const spec = result.assignments.find((assignment) => assignment.identityId === "s7cls-lid-r4-driver");
    const binding = result.assignments.find((assignment) => assignment.identityId === "s7cls-lid-r4-binding");
    expect(spec).toMatchObject({
      rClass: "R4",
      disposition: "mapped",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
    });
    expect(binding).toMatchObject({
      rClass: "R4",
      disposition: "mapped",
      ownerScopeKind: "organization",
      sourceKind: "project-parameter-binding",
    });
    expect(FROZEN_P0_GRAPH_FIXTURE.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "s7cls-bind-r4",
          organizationId: "s7cls-org",
          parameterSpecId: "s7cls-spec-r4-driver",
        }),
      ]),
    );
    expect(result.blockers.some((blocker) => blocker.identityId === "s7cls-lid-r4-driver")).toBe(
      false,
    );
  });

  it("still blocks when a binding organization disagrees with its module owner", () => {
    const mutated = {
      ...FROZEN_P0_GRAPH_FIXTURE,
      bindings: FROZEN_P0_GRAPH_FIXTURE.bindings.map((binding) =>
        binding.id === "s7cls-bind-r4"
          ? { ...binding, organizationId: "s7cls-other-org" }
          : binding,
      ),
    };
    const result = classifyFrozenP0Graph(mutated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = result.value.assignments.find((assignment) => assignment.identityId === "s7cls-lid-r4-driver");
    const binding = result.value.assignments.find((assignment) => assignment.identityId === "s7cls-lid-r4-binding");
    expect(spec?.rClass).toBe("R0");
    expect(binding?.rClass).toBe("R0");
    expect(result.value.blockers.some((blocker) => blocker.invariant === "binding-module-owner-mismatch")).toBe(
      true,
    );
  });

  it("treats R0 as a hard blocker and never archives it as success", () => {
    const result = classifiedFixture();
    const r0 = result.assignments.filter((assignment) => assignment.rClass === "R0");
    expect(r0.length).toBeGreaterThan(0);
    expect(r0.every((assignment) => assignment.disposition === "blocked")).toBe(true);
    expect(r0.every((assignment) => assignment.disposition !== "archived")).toBe(true);
    expect(result.blockers).toHaveLength(r0.length);
    expect(result.blockers.every((blocker) => blocker.disposition === "blocked")).toBe(true);
    expect(result.blockers.every((blocker) => blocker.rClass === "R0")).toBe(true);
    expect(DISPOSITION_BY_R_CLASS.R0).toBe("blocked");
  });

  it("keeps same-key R6 and R8 as separate ReviewEvidence and DefinitionProposal identities", () => {
    const result = classifiedFixture();
    const r6 = result.assignments.find((assignment) => assignment.rClass === "R6");
    const r8 = result.assignments.find((assignment) => assignment.rClass === "R8");
    expect(r6).toMatchObject({
      propertyKey: SAME_KEY_R6_R8_PROPERTY_KEY,
      disposition: "review-evidence",
      identityId: "s7cls-lid-r6-twin",
    });
    expect(r8).toMatchObject({
      propertyKey: SAME_KEY_R6_R8_PROPERTY_KEY,
      disposition: "definition-proposal",
      identityId: "s7cls-lid-r8-twin",
    });
    expect(r6?.identityId).not.toBe(r8?.identityId);
    expect(r6?.sourceId).not.toBe(r8?.sourceId);
  });

  it("is repeatable for the same graph fingerprint", () => {
    const first = classifiedFixture();
    const second = classifiedFixture();
    expect(first.graphFingerprint).toBe(`sha256:${FROZEN_P0_GRAPH_SHA256}`);
    expect(first.graphFingerprint).toBe(fingerprintP0Graph(FROZEN_P0_GRAPH_FIXTURE));
    expect(second.graphFingerprint).toBe(first.graphFingerprint);
    expect(second.assignments).toEqual(first.assignments);
    expect(second.blockers).toEqual(first.blockers);
    expect(first.graphFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("does not change classes when identity enumeration order changes", () => {
    const reordered = {
      ...FROZEN_P0_GRAPH_FIXTURE,
      identities: [...FROZEN_P0_GRAPH_FIXTURE.identities].reverse(),
    };
    const original = classifiedFixture();
    const shuffled = classifyFrozenP0Graph(reordered);
    expect(shuffled.ok).toBe(true);
    if (!shuffled.ok) return;
    expect(shuffled.value.graphFingerprint).toBe(original.graphFingerprint);
    expect(shuffled.value.assignments).toEqual(original.assignments);
  });

  it("rejects a graph with duplicate source identities instead of merging them", () => {
    const duplicate = {
      ...FROZEN_P0_GRAPH_FIXTURE,
      identities: [
        ...FROZEN_P0_GRAPH_FIXTURE.identities,
        FROZEN_P0_GRAPH_FIXTURE.identities[0]!,
      ],
    };
    const result = classifyFrozenP0Graph(duplicate);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-CLASS-DUPLICATE-PRIMARY");
  });
});
