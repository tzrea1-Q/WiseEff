import { createHash } from "node:crypto";

import {
  legacyMappingSourceKinds,
  type LegacyMappingSourceKind,
} from "../parameter-catalog-contract/legacyIdentifiers";
import { R_CLASSES, type OwnerScopeKind, type RClass } from "./classifier/types";
import { MAPPING_TARGET_KINDS, type MappingVersion } from "./mapping/types";

export type MappingManifestSelection = {
  readonly legacyIdentityId: string;
  readonly sourceKind: LegacyMappingSourceKind;
  readonly sourceId: string;
  readonly ownerScopeKind: OwnerScopeKind;
  readonly ownerScopeId: string;
  readonly rClass: RClass;
  readonly disposition: "mapped" | "archived" | "review-evidence" | "definition-proposal";
  readonly status: "appended" | "replayed";
  readonly headCasVersion: number;
  readonly mappingVersion: MappingVersion;
};

export type MappingManifestV2WithoutDigest = {
  readonly schemaVersion: 2;
  readonly selectionRunId: string;
  readonly planDigest: string;
  readonly sourceSnapshotFingerprint: string;
  readonly targetArtifactSha: string;
  readonly catalogReleaseId: string;
  readonly catalogReleaseDigest: string;
  readonly selectionCount: number;
  readonly selections: readonly MappingManifestSelection[];
};

export type MappingManifestV2 = MappingManifestV2WithoutDigest & {
  readonly digest: string;
};

const DISPOSITIONS = ["mapped", "archived", "review-evidence", "definition-proposal"] as const;
const OWNER_SCOPE_KINDS = ["platform", "organization", "project"] as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_SHA = /^[0-9a-f]{40}$/;

const selectionTuple = (selection: MappingManifestSelection): readonly unknown[] => [
  selection.legacyIdentityId,
  selection.sourceKind,
  selection.sourceId,
  selection.ownerScopeKind,
  selection.ownerScopeId,
  selection.rClass,
  selection.disposition,
  selection.status,
  selection.headCasVersion,
  selection.mappingVersion.id,
  selection.mappingVersion.legacyIdentityId,
  selection.mappingVersion.cutoverRunId,
  selection.mappingVersion.versionNumber,
  selection.mappingVersion.sourceChecksum,
  selection.mappingVersion.graphFingerprint,
  selection.mappingVersion.rClass,
  selection.mappingVersion.targetKind,
  selection.mappingVersion.targetId,
  selection.mappingVersion.archiveId,
  selection.mappingVersion.evidenceArchiveId,
  selection.mappingVersion.supersedesVersionId,
];

export const mappingManifestDigestFor = (
  manifest: MappingManifestV2WithoutDigest,
): string =>
  `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        manifest.schemaVersion,
        manifest.selectionRunId,
        manifest.planDigest,
        manifest.sourceSnapshotFingerprint,
        manifest.targetArtifactSha,
        manifest.catalogReleaseId,
        manifest.catalogReleaseDigest,
        manifest.selectionCount,
        manifest.selections.map(selectionTuple),
      ]),
    )
    .digest("hex")}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);

const isOwnerScopeKind = (value: unknown): value is OwnerScopeKind =>
  OWNER_SCOPE_KINDS.includes(value as (typeof OWNER_SCOPE_KINDS)[number]);

const isRClass = (value: unknown): value is RClass =>
  R_CLASSES.includes(value as RClass);

const isMappingVersion = (
  value: unknown,
  legacyIdentityId: string,
  rClass: RClass,
  sourceSnapshotFingerprint: string,
): value is MappingVersion => {
  if (!isRecord(value)) return false;
  return (
    isText(value.id) &&
    value.legacyIdentityId === legacyIdentityId &&
    isText(value.cutoverRunId) &&
    Number.isSafeInteger(value.versionNumber) &&
    (value.versionNumber as number) > 0 &&
    value.sourceChecksum === sourceSnapshotFingerprint &&
    value.graphFingerprint === sourceSnapshotFingerprint &&
    value.rClass === rClass &&
    (value.targetKind === null ||
      MAPPING_TARGET_KINDS.includes(value.targetKind as (typeof MAPPING_TARGET_KINDS)[number])) &&
    isNullableText(value.targetId) &&
    isNullableText(value.archiveId) &&
    isNullableText(value.evidenceArchiveId) &&
    isNullableText(value.supersedesVersionId)
  );
};

const parseSelection = (
  value: unknown,
  sourceSnapshotFingerprint: string,
): MappingManifestSelection | null => {
  if (!isRecord(value)) return null;
  const selection = value as Partial<MappingManifestSelection>;
  if (
    !isText(selection.legacyIdentityId) ||
    typeof selection.sourceKind !== "string" ||
    !legacyMappingSourceKinds.includes(selection.sourceKind as LegacyMappingSourceKind) ||
    !isText(selection.sourceId) ||
    !isOwnerScopeKind(selection.ownerScopeKind) ||
    !isText(selection.ownerScopeId) ||
    !isRClass(selection.rClass) ||
    !DISPOSITIONS.includes(selection.disposition as (typeof DISPOSITIONS)[number]) ||
    (selection.status !== "appended" && selection.status !== "replayed") ||
    !Number.isSafeInteger(selection.headCasVersion) ||
    (selection.headCasVersion as number) < 1 ||
    !isMappingVersion(
      selection.mappingVersion,
      selection.legacyIdentityId,
      selection.rClass,
      sourceSnapshotFingerprint,
    )
  ) {
    return null;
  }
  if (selection.disposition === "archived") {
    if (selection.mappingVersion.archiveId === null || selection.mappingVersion.targetId !== null) return null;
  } else if (selection.mappingVersion.targetId === null || selection.mappingVersion.archiveId !== null) {
    return null;
  }
  return selection as MappingManifestSelection;
};

export const parseMappingManifestV2 = (value: unknown): MappingManifestV2 | null => {
  if (!isRecord(value) || value.schemaVersion !== 2) return null;
  const candidate = value as Partial<MappingManifestV2>;
  if (
    !isText(candidate.selectionRunId) ||
    !isText(candidate.planDigest) ||
    !DIGEST.test(candidate.planDigest) ||
    !isText(candidate.sourceSnapshotFingerprint) ||
    !DIGEST.test(candidate.sourceSnapshotFingerprint) ||
    !isText(candidate.targetArtifactSha) ||
    !ARTIFACT_SHA.test(candidate.targetArtifactSha) ||
    !isText(candidate.catalogReleaseId) ||
    !isText(candidate.catalogReleaseDigest) ||
    !DIGEST.test(candidate.catalogReleaseDigest) ||
    !Number.isSafeInteger(candidate.selectionCount) ||
    (candidate.selectionCount as number) < 1 ||
    !Array.isArray(candidate.selections) ||
    candidate.selectionCount !== candidate.selections.length ||
    !isText(candidate.digest) ||
    !DIGEST.test(candidate.digest)
  ) {
    return null;
  }

  const selections: MappingManifestSelection[] = [];
  for (const item of candidate.selections) {
    const selection = parseSelection(item, candidate.sourceSnapshotFingerprint);
    if (!selection) return null;
    const previous = selections.at(-1);
    if (previous && previous.legacyIdentityId >= selection.legacyIdentityId) return null;
    selections.push(selection);
  }

  const withoutDigest: MappingManifestV2WithoutDigest = {
    schemaVersion: 2,
    selectionRunId: candidate.selectionRunId,
    planDigest: candidate.planDigest,
    sourceSnapshotFingerprint: candidate.sourceSnapshotFingerprint,
    targetArtifactSha: candidate.targetArtifactSha,
    catalogReleaseId: candidate.catalogReleaseId,
    catalogReleaseDigest: candidate.catalogReleaseDigest,
    selectionCount: candidate.selectionCount,
    selections,
  };
  if (mappingManifestDigestFor(withoutDigest) !== candidate.digest) return null;
  return { ...withoutDigest, digest: candidate.digest };
};
