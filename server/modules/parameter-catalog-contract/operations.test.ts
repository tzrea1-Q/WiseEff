import { describe, expect, it } from "vitest";

import {
  SubjectPlacementId,
  catalogCutoverOperations,
  catalogKernelOperations,
  releaseVerificationOperations,
  reviewResolutionTypes,
  type PlacementIntent
} from "./index";

const placementLabel = (intent: PlacementIntent): string => {
  switch (intent.mode) {
    case "use-default":
      return "default";
    case "choose-parent":
      return intent.displayName;
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
};

// @ts-expect-error Placement intent is closed; callers cannot request inference.
const inferredPlacement: PlacementIntent = { mode: "infer-parent" };

void inferredPlacement;

describe("parameter catalog operations", () => {
  it("freezes the three deep-module operation surfaces", () => {
    expect(catalogKernelOperations).toEqual([
      "compilePublishedRelease",
      "installPublishedRelease",
      "switchBackBeforeTraffic",
      "verifyCurrentMaterialization",
      "loadCurrentCatalog",
      "loadPinnedCatalog"
    ]);
    expect(catalogCutoverOperations).toEqual([
      "planCutover",
      "executeCutover",
      "inspectCutover",
      "recoverCutover"
    ]);
    expect(releaseVerificationOperations).toEqual([
      "prepareVerification",
      "runVerification",
      "assembleReport",
      "approveReport",
      "readReport"
    ]);
  });

  it("freezes review-resolution and placement discriminants", () => {
    expect(reviewResolutionTypes).toEqual([
      "register-subject",
      "restore-registration",
      "mark-out-of-scope",
      "open-definition-proposal"
    ]);
    expect(placementLabel({ mode: "use-default" })).toBe("default");
    expect(
      placementLabel({
        mode: "choose-parent",
        parentPlacementId: SubjectPlacementId("spla_root_drivers"),
        displayName: "Charging ICs"
      })
    ).toBe("Charging ICs");
  });
});
