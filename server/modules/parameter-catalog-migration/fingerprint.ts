/**
 * The frozen preview identity (#847 §7 risk 4).
 *
 * A single `sha256:` fingerprint over the canonical command model — old
 * identity + expected old revision, the minted replacement identity, the
 * approved project manifest, and each project's frozen
 * (bindingId, currentValueId, configRevisionId, sourceRef) tip, plus the
 * predecessor release and the capability/policy revisions.  Execute and
 * continue recompute it and reject any mismatch, so an ETag/version alone can
 * never miss a source or per-project tip change.
 */
import { createHash } from "node:crypto";

import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract/index";

import type { FrozenProjectTip } from "./types";
import { toContractJson } from "./types";

export type ReplacementPreviewFingerprintModel = {
  readonly oldDefinitionId: string;
  readonly oldRevisionId: string;
  readonly newDefinitionId: string;
  readonly newSubjectId: string;
  readonly newPropertyKey: string;
  readonly newRevisionId: string;
  readonly approvedProjectIds: readonly string[];
  readonly projects: readonly {
    readonly projectId: string;
    readonly bindingId: string;
    readonly currentValueId: string;
    readonly configRevisionId: string;
    readonly sourceRef: string;
  }[];
  readonly previewReleaseId: string;
  readonly capabilityContractDigest: string;
  readonly policyRevision: number;
};

export const replacementPreviewFingerprintModel = (input: {
  readonly oldDefinitionId: string;
  readonly oldRevisionId: string;
  readonly newDefinitionId: string;
  readonly newSubjectId: string;
  readonly newPropertyKey: string;
  readonly newRevisionId: string;
  readonly manifest: readonly FrozenProjectTip[];
  readonly previewReleaseId: string;
  readonly capabilityContractDigest: string;
  readonly policyRevision: number;
}): ReplacementPreviewFingerprintModel => ({
  oldDefinitionId: input.oldDefinitionId,
  oldRevisionId: input.oldRevisionId,
  newDefinitionId: input.newDefinitionId,
  newSubjectId: input.newSubjectId,
  newPropertyKey: input.newPropertyKey,
  newRevisionId: input.newRevisionId,
  approvedProjectIds: [...input.manifest.map((project) => project.projectId)].sort(),
  projects: [...input.manifest]
    .sort((left, right) => (left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0))
    .map((project) => ({
      projectId: project.projectId,
      bindingId: project.bindingId,
      currentValueId: project.currentValueId,
      configRevisionId: project.configRevisionId,
      sourceRef: project.sourceRef,
    })),
  previewReleaseId: input.previewReleaseId,
  capabilityContractDigest: input.capabilityContractDigest,
  policyRevision: input.policyRevision,
});

export const fingerprintReplacementPreview = (
  input: Parameters<typeof replacementPreviewFingerprintModel>[0],
): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(replacementPreviewFingerprintModel(input) as unknown as ContractJsonValue))
    .digest("hex")}`;

export const canonicalJson = (value: unknown): ContractJsonValue => toContractJson(value);
