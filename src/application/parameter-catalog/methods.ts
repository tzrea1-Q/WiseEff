export const PARAMETER_CATALOG_REPOSITORY_METHODS = [
  "getCatalog",
  "listSubjects",
  "getSubject",
  "listSubjectDefinitions",
  "listDefinitions",
  "getDefinition",
  "listDefinitionRevisions",
  "getDefinitionRevision",
  "listDefinitionTimeline",
  "getLegacyIdentifier"
] as const;

export const PARAMETER_CATALOG_GOVERNANCE_REPOSITORY_METHODS = [
  "listRegistrations",
  "createRegistration",
  "getRegistration",
  "retireRegistration",
  "restoreRegistration",
  "getPlacement",
  "updatePlacement",
  "listObservations",
  "getObservation",
  "listReviewItems",
  "getReviewItem",
  "resolveReviewItem",
  "listProposals",
  "createProposal",
  "getProposal",
  "submitProposal",
  "withdrawProposal",
  "acceptProposal",
  "rejectProposal"
] as const;
