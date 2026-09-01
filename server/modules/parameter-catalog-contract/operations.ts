import type { SubjectPlacementId } from "./ids";

const freezeRegistry = <const Values extends readonly unknown[]>(values: Values): Values => {
  Object.freeze(values);
  return values;
};

export const catalogKernelOperations = freezeRegistry([
  "compilePublishedRelease",
  "installPublishedRelease",
  "switchBackBeforeTraffic",
  "verifyCurrentMaterialization",
  "loadCurrentCatalog",
  "loadPinnedCatalog"
]);
export type CatalogKernelOperation = (typeof catalogKernelOperations)[number];

export const catalogCutoverOperations = freezeRegistry([
  "planCutover",
  "executeCutover",
  "inspectCutover",
  "recoverCutover"
]);
export type CatalogCutoverOperation = (typeof catalogCutoverOperations)[number];

export const releaseVerificationOperations = freezeRegistry([
  "prepareVerification",
  "runVerification",
  "assembleReport",
  "approveReport",
  "readReport"
]);
export type ReleaseVerificationOperation = (typeof releaseVerificationOperations)[number];

export const reviewResolutionTypes = freezeRegistry([
  "register-subject",
  "restore-registration",
  "mark-out-of-scope",
  "open-definition-proposal"
]);
export type ReviewResolutionType = (typeof reviewResolutionTypes)[number];

export type PlacementIntent =
  | { readonly mode: "use-default" }
  | {
      readonly mode: "choose-parent";
      readonly parentPlacementId: SubjectPlacementId;
      readonly displayName: string;
    };
