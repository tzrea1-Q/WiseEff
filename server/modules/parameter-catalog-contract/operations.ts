import type { SubjectPlacementId } from "./ids";

export const catalogKernelOperations = [
  "compilePublishedRelease",
  "installPublishedRelease",
  "switchBackBeforeTraffic",
  "verifyCurrentMaterialization",
  "loadCurrentCatalog",
  "loadPinnedCatalog"
] as const;
export type CatalogKernelOperation = (typeof catalogKernelOperations)[number];

export const catalogCutoverOperations = [
  "planCutover",
  "executeCutover",
  "inspectCutover",
  "recoverCutover"
] as const;
export type CatalogCutoverOperation = (typeof catalogCutoverOperations)[number];

export const releaseVerificationOperations = [
  "prepareVerification",
  "runVerification",
  "assembleReport",
  "approveReport",
  "readReport"
] as const;
export type ReleaseVerificationOperation = (typeof releaseVerificationOperations)[number];

export const reviewResolutionTypes = [
  "register-subject",
  "restore-registration",
  "mark-out-of-scope",
  "open-definition-proposal"
] as const;
export type ReviewResolutionType = (typeof reviewResolutionTypes)[number];

export type PlacementIntent =
  | { readonly mode: "use-default" }
  | {
      readonly mode: "choose-parent";
      readonly parentPlacementId: SubjectPlacementId;
      readonly displayName: string;
    };
