/**
 * Definition identity correction migration (#847).
 *
 * One high-level governance capability: preview, create, read, list and
 * continue.  It coordinates the existing authoring/publication, registration,
 * binding/value and audit capabilities through their public seams and never
 * authors Catalog truth directly.
 */
export {
  createParameterCatalogMigrationService,
  unavailableDefinitionMigrationPorts,
  type CatalogDefinitionMigrationPorts,
} from "./service";
export {
  DEFINITION_REPLACEMENT_CONTINUE_FAMILY,
  DEFINITION_REPLACEMENT_EXECUTE_FAMILY,
  DEFINITION_REPLACEMENT_MAX_PROJECTS,
  DEFINITION_REPLACEMENT_PREVIEW_TTL_MS,
  type ReplacementProjectStatus,
  type ContinueDefinitionReplacementCommand,
  type CreateDefinitionReplacementCommand,
  type DefinitionReplacementFailure,
  type DefinitionReplacementPreviewView,
  type DefinitionReplacementServiceInput,
  type DefinitionReplacementView,
  type FrozenProjectTip,
  type GetDefinitionReplacementQuery,
  type ListDefinitionReplacementsQuery,
  type PreviewDefinitionReplacementCommand,
  type ReplacementPublicationPorts,
  type ReplacementProjectView,
  type TrustedMigrationContext,
} from "./types";
export {
  fingerprintReplacementPreview,
  replacementPreviewFingerprintModel,
} from "./fingerprint";
export {
  classifySourceFormat,
  deriveDtsSourceRef,
  detectCoupledSourceImpact,
  evaluateValueCompatibility,
  resolveSourceLocation,
  type ResolvedSourceLocation,
  type SourceProvenanceFacts,
} from "./evaluate";
