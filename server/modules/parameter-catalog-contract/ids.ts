declare const parameterCatalogContractBrand: unique symbol;

type Branded<Value, Name extends string> = Value & {
  readonly [parameterCatalogContractBrand]: Name;
};

const brandString = <Name extends string>(
  value: string,
): Branded<string, Name> => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(value)
  ) {
    throw new TypeError(
      "Branded contract strings must be non-empty, control-free, and have no surrounding whitespace",
    );
  }
  return value as Branded<string, Name>;
};

const brandNumber = <Name extends string>(
  value: number,
): Branded<number, Name> => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError("Branded contract numbers must be safe integers");
  }
  return value as Branded<number, Name>;
};

export type CatalogReleaseId = Branded<string, "CatalogReleaseId">;
export const CatalogReleaseId = (value: string): CatalogReleaseId =>
  brandString<"CatalogReleaseId">(value);

export type CatalogReleaseDigest = Branded<string, "CatalogReleaseDigest">;
export const CatalogReleaseDigest = (value: string): CatalogReleaseDigest =>
  brandString<"CatalogReleaseDigest">(value);

export type CatalogReleaseVersion = Branded<string, "CatalogReleaseVersion">;
export const CatalogReleaseVersion = (value: string): CatalogReleaseVersion =>
  brandString<"CatalogReleaseVersion">(value);

export type CatalogMaterializationFingerprint = Branded<
  string,
  "CatalogMaterializationFingerprint"
>;
export const CatalogMaterializationFingerprint = (
  value: string
): CatalogMaterializationFingerprint =>
  brandString<"CatalogMaterializationFingerprint">(value);

export type CatalogSubjectId = Branded<string, "CatalogSubjectId">;
export const CatalogSubjectId = (value: string): CatalogSubjectId =>
  brandString<"CatalogSubjectId">(value);

export type CatalogAliasId = Branded<string, "CatalogAliasId">;
export const CatalogAliasId = (value: string): CatalogAliasId =>
  brandString<"CatalogAliasId">(value);

export type CatalogCanonicalKey = Branded<string, "CatalogCanonicalKey">;
export const CatalogCanonicalKey = (value: string): CatalogCanonicalKey =>
  brandString<"CatalogCanonicalKey">(value);

export type ParameterDefinitionId = Branded<string, "ParameterDefinitionId">;
export const ParameterDefinitionId = (value: string): ParameterDefinitionId =>
  brandString<"ParameterDefinitionId">(value);

export type DefinitionRevisionId = Branded<string, "DefinitionRevisionId">;
export const DefinitionRevisionId = (value: string): DefinitionRevisionId =>
  brandString<"DefinitionRevisionId">(value);

export type DefinitionContentDigest = Branded<string, "DefinitionContentDigest">;
export const DefinitionContentDigest = (value: string): DefinitionContentDigest =>
  brandString<"DefinitionContentDigest">(value);

export type CatalogTimelineFactId = Branded<string, "CatalogTimelineFactId">;
export const CatalogTimelineFactId = (value: string): CatalogTimelineFactId =>
  brandString<"CatalogTimelineFactId">(value);

export type CatalogCursor = Branded<string, "CatalogCursor">;
export const CatalogCursor = (value: string): CatalogCursor =>
  brandString<"CatalogCursor">(value);

export type CatalogSearchText = Branded<string, "CatalogSearchText">;
export const CatalogSearchText = (value: string): CatalogSearchText =>
  brandString<"CatalogSearchText">(value);

export type CatalogPageLimit = Branded<number, "CatalogPageLimit">;
export const CatalogPageLimit = (value: number): CatalogPageLimit => {
  const branded = brandNumber<"CatalogPageLimit">(value);
  if (branded <= 0) {
    throw new TypeError("CatalogPageLimit must be positive");
  }
  return branded;
};

export type CatalogReleaseSequence = Branded<number, "CatalogReleaseSequence">;
export const CatalogReleaseSequence = (value: number): CatalogReleaseSequence => {
  const branded = brandNumber<"CatalogReleaseSequence">(value);
  if (branded < 0) {
    throw new TypeError("CatalogReleaseSequence must be non-negative");
  }
  return branded;
};

export type CatalogEventTime = Branded<string, "CatalogEventTime">;
export const CatalogEventTime = (value: string): CatalogEventTime =>
  brandString<"CatalogEventTime">(value);

export type CatalogTombstoneReason = Branded<string, "CatalogTombstoneReason">;
export const CatalogTombstoneReason = (value: string): CatalogTombstoneReason =>
  brandString<"CatalogTombstoneReason">(value);

export type CatalogSelectionFingerprint = Branded<
  string,
  "CatalogSelectionFingerprint"
>;
export const CatalogSelectionFingerprint = (value: string): CatalogSelectionFingerprint =>
  brandString<"CatalogSelectionFingerprint">(value);

export type PropertyKey = Branded<string, "PropertyKey">;
export const PropertyKey = (value: string): PropertyKey =>
  brandString<"PropertyKey">(value);

export type DriverCompatible = Branded<string, "DriverCompatible">;
export const DriverCompatible = (value: string): DriverCompatible =>
  brandString<"DriverCompatible">(value);

export type NormalizedNodeTypeName = Branded<string, "NormalizedNodeTypeName">;
export const NormalizedNodeTypeName = (value: string): NormalizedNodeTypeName =>
  brandString<"NormalizedNodeTypeName">(value);

export type MaintenanceAttemptId = Branded<string, "MaintenanceAttemptId">;
export const MaintenanceAttemptId = (value: string): MaintenanceAttemptId =>
  brandString<"MaintenanceAttemptId">(value);

export type SubjectRegistrationId = Branded<string, "SubjectRegistrationId">;
export const SubjectRegistrationId = (value: string): SubjectRegistrationId =>
  brandString<"SubjectRegistrationId">(value);

export type SubjectPlacementId = Branded<string, "SubjectPlacementId">;
export const SubjectPlacementId = (value: string): SubjectPlacementId =>
  brandString<"SubjectPlacementId">(value);

export type ParameterObservationId = Branded<string, "ParameterObservationId">;
export const ParameterObservationId = (value: string): ParameterObservationId =>
  brandString<"ParameterObservationId">(value);

export type ObservationMatchId = Branded<string, "ObservationMatchId">;
export const ObservationMatchId = (value: string): ObservationMatchId =>
  brandString<"ObservationMatchId">(value);

export type ReviewEvidenceId = Branded<string, "ReviewEvidenceId">;
export const ReviewEvidenceId = (value: string): ReviewEvidenceId =>
  brandString<"ReviewEvidenceId">(value);

export type ReviewItemId = Branded<string, "ReviewItemId">;
export const ReviewItemId = (value: string): ReviewItemId =>
  brandString<"ReviewItemId">(value);

export type ReviewResolutionId = Branded<string, "ReviewResolutionId">;
export const ReviewResolutionId = (value: string): ReviewResolutionId =>
  brandString<"ReviewResolutionId">(value);

export type DefinitionProposalId = Branded<string, "DefinitionProposalId">;
export const DefinitionProposalId = (value: string): DefinitionProposalId =>
  brandString<"DefinitionProposalId">(value);

export type DefinitionProposalRevisionId = Branded<
  string,
  "DefinitionProposalRevisionId"
>;
export const DefinitionProposalRevisionId = (value: string): DefinitionProposalRevisionId =>
  brandString<"DefinitionProposalRevisionId">(value);

export type PublicationIntentId = Branded<string, "PublicationIntentId">;
export const PublicationIntentId = (value: string): PublicationIntentId =>
  brandString<"PublicationIntentId">(value);

export type ParameterBindingId = Branded<string, "ParameterBindingId">;
export const ParameterBindingId = (value: string): ParameterBindingId =>
  brandString<"ParameterBindingId">(value);

export type ProjectValueId = Branded<string, "ProjectValueId">;
export const ProjectValueId = (value: string): ProjectValueId =>
  brandString<"ProjectValueId">(value);

export type LegacyIdentityId = Branded<string, "LegacyIdentityId">;
export const LegacyIdentityId = (value: string): LegacyIdentityId =>
  brandString<"LegacyIdentityId">(value);

export type LegacyMappingId = Branded<string, "LegacyMappingId">;
export const LegacyMappingId = (value: string): LegacyMappingId =>
  brandString<"LegacyMappingId">(value);

export type ArchiveRecordId = Branded<string, "ArchiveRecordId">;
export const ArchiveRecordId = (value: string): ArchiveRecordId =>
  brandString<"ArchiveRecordId">(value);

export type CutoverRunId = Branded<string, "CutoverRunId">;
export const CutoverRunId = (value: string): CutoverRunId =>
  brandString<"CutoverRunId">(value);

export type VerificationPlanId = Branded<string, "VerificationPlanId">;
export const VerificationPlanId = (value: string): VerificationPlanId =>
  brandString<"VerificationPlanId">(value);

export type VerificationAttemptId = Branded<string, "VerificationAttemptId">;
export const VerificationAttemptId = (value: string): VerificationAttemptId =>
  brandString<"VerificationAttemptId">(value);

export type VerificationReportId = Branded<string, "VerificationReportId">;
export const VerificationReportId = (value: string): VerificationReportId =>
  brandString<"VerificationReportId">(value);

export type ReleaseApprovalId = Branded<string, "ReleaseApprovalId">;
export const ReleaseApprovalId = (value: string): ReleaseApprovalId =>
  brandString<"ReleaseApprovalId">(value);

export type RuntimePinId = Branded<string, "RuntimePinId">;
export const RuntimePinId = (value: string): RuntimePinId =>
  brandString<"RuntimePinId">(value);

export type RecoveryPointId = Branded<string, "RecoveryPointId">;
export const RecoveryPointId = (value: string): RecoveryPointId =>
  brandString<"RecoveryPointId">(value);

export type VerificationPlanDigest = Branded<string, "VerificationPlanDigest">;
export const VerificationPlanDigest = (value: string): VerificationPlanDigest =>
  brandString<"VerificationPlanDigest">(value);

export type VerificationReportDigest = Branded<string, "VerificationReportDigest">;
export const VerificationReportDigest = (value: string): VerificationReportDigest =>
  brandString<"VerificationReportDigest">(value);

export type EvidenceDigest = Branded<string, "EvidenceDigest">;
export const EvidenceDigest = (value: string): EvidenceDigest =>
  brandString<"EvidenceDigest">(value);

export type CutoverPlanDigest = Branded<string, "CutoverPlanDigest">;
export const CutoverPlanDigest = (value: string): CutoverPlanDigest =>
  brandString<"CutoverPlanDigest">(value);

export type RecoveryPointDigest = Branded<string, "RecoveryPointDigest">;
export const RecoveryPointDigest = (value: string): RecoveryPointDigest =>
  brandString<"RecoveryPointDigest">(value);

export type IdempotencyKey = Branded<string, "IdempotencyKey">;
export const IdempotencyKey = (value: string): IdempotencyKey =>
  brandString<"IdempotencyKey">(value);

export type RequestFingerprint = Branded<string, "RequestFingerprint">;
export const RequestFingerprint = (value: string): RequestFingerprint =>
  brandString<"RequestFingerprint">(value);

export type ReviewItemEtag = Branded<string, "ReviewItemEtag">;
export const ReviewItemEtag = (value: string): ReviewItemEtag =>
  brandString<"ReviewItemEtag">(value);
