import { describe, expect, it } from "vitest";

import {
  mergeInitializationBindingCandidates,
  type InitializationBindingCandidate
} from "./mergeInitializationBindings";

function candidate(
  overrides: Partial<InitializationBindingCandidate> &
    Pick<InitializationBindingCandidate, "sourceProjectId" | "sourceBindingId" | "parameterSpecId" | "moduleId">
): InitializationBindingCandidate {
  return {
    sourceProjectValueId: overrides.sourceProjectValueId ?? overrides.sourceBindingId,
    propertyKey: "fast_charge_current",
    parameterSpecVersionId: "psv-1",
    risk: "High",
    effectiveValue: { kind: "u32", value: 3200 },
    rawValue: "3200",
    ...overrides
  };
}

describe("mergeInitializationBindingCandidates", () => {
  it("keeps every canonical source value and exposes same-definition conflicts", () => {
    const primary = [
      candidate({
        sourceProjectId: "aurora",
        sourceBindingId: "b-aurora-1",
        parameterSpecId: "spec-a",
        moduleId: "mod-charge"
      }),
      candidate({
        sourceProjectId: "aurora",
        sourceBindingId: "b-aurora-2",
        parameterSpecId: "spec-b",
        moduleId: "mod-charge",
        propertyKey: "temp_limit"
      })
    ];
    const supplements = [
      [
        candidate({
          sourceProjectId: "atlas",
          sourceBindingId: "b-atlas-1",
          parameterSpecId: "spec-a",
          moduleId: "mod-charge",
          rawValue: "3800"
        }),
        candidate({
          sourceProjectId: "atlas",
          sourceBindingId: "b-atlas-3",
          parameterSpecId: "spec-c",
          moduleId: "mod-thermal",
          propertyKey: "thermal_cap"
        })
      ],
      [
        candidate({
          sourceProjectId: "nebula",
          sourceBindingId: "b-nebula-3",
          parameterSpecId: "spec-c",
          moduleId: "mod-thermal",
          propertyKey: "thermal_cap",
          rawValue: "99"
        }),
        candidate({
          sourceProjectId: "nebula",
          sourceBindingId: "b-nebula-4",
          parameterSpecId: "spec-d",
          moduleId: "mod-misc",
          propertyKey: "misc_flag"
        })
      ]
    ];

    const merged = mergeInitializationBindingCandidates({ primary, supplements });

    expect(merged.map((item) => ({
      sourceBindingId: item.sourceBindingId,
      sourceRole: item.sourceRole,
      alternativeSourceBindingIds: item.alternativeSourceBindingIds
    }))).toEqual([
      {
        sourceBindingId: "b-aurora-1",
        sourceRole: "primary",
        alternativeSourceBindingIds: ["b-atlas-1"],
      },
      {
        sourceBindingId: "b-aurora-2",
        sourceRole: "primary",
        alternativeSourceBindingIds: []
      },
      {
        sourceBindingId: "b-atlas-1",
        sourceRole: "supplement",
        alternativeSourceBindingIds: ["b-aurora-1"]
      },
      {
        sourceBindingId: "b-atlas-3",
        sourceRole: "supplement",
        alternativeSourceBindingIds: ["b-nebula-3"]
      },
      {
        sourceBindingId: "b-nebula-3",
        sourceRole: "supplement",
        alternativeSourceBindingIds: ["b-atlas-3"]
      },
      {
        sourceBindingId: "b-nebula-4",
        sourceRole: "supplement",
        alternativeSourceBindingIds: []
      }
    ]);
  });

  it.each([
    { sourceFormat: "dts" as const, rawValue: "", effectiveValue: { kind: "boolean", present: true }, needsConfirmation: false },
    { sourceFormat: "dts" as const, rawValue: "", effectiveValue: { kind: "empty" }, needsConfirmation: false },
    { sourceFormat: "dts" as const, rawValue: "   ", effectiveValue: null, needsConfirmation: true },
    { sourceFormat: "json" as const, rawValue: "", effectiveValue: { kind: "boolean", present: true }, needsConfirmation: true },
    { sourceFormat: "dts" as const, rawValue: "", effectiveValue: { kind: "u32", value: 3200 }, needsConfirmation: true }
  ])("requires confirmation except for typed DTS presence values: %j", ({ sourceFormat, rawValue, effectiveValue, needsConfirmation }) => {
    const merged = mergeInitializationBindingCandidates({
      primary: [
        candidate({
          sourceProjectId: "aurora",
          sourceBindingId: "b-empty",
          parameterSpecId: "spec-e",
          moduleId: "mod-x",
          sourceFormat,
          rawValue,
          effectiveValue
        })
      ],
      supplements: []
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.needsEffectiveValueConfirmation).toBe(needsConfirmation);
    expect(merged[0]?.currentValueState).toBe("pending_project_confirmation");
  });

  it("keeps same-name values from different definitions independent", () => {
    const merged = mergeInitializationBindingCandidates({
      primary: [
        candidate({
          sourceProjectId: "aurora",
          sourceBindingId: "b-limit-a",
          sourceProjectValueId: "v-limit-a",
          parameterSpecId: "definition-a",
          moduleId: "mod-charge",
          propertyKey: "limit",
        }),
        candidate({
          sourceProjectId: "aurora",
          sourceBindingId: "b-limit-b",
          sourceProjectValueId: "v-limit-b",
          parameterSpecId: "definition-b",
          moduleId: "mod-charge",
          propertyKey: "limit",
        }),
      ],
      supplements: [],
    });

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.parameterSpecId)).toEqual(["definition-a", "definition-b"]);
    expect(merged.every((item) => item.alternativeSourceBindingIds.length === 0)).toBe(true);
  });
});
