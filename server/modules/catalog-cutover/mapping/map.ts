import type { ClassificationAssignment } from "../classifier";
import {
  casMappingHead,
  countMappingHeads,
  fail,
  insertMappingHead,
  insertMappingVersion,
  isExactReplay,
  loadMappingHead,
  loadStoredIdentity,
  lockMappingIdentity,
  mintMappingVersionId,
  nextVersionNumber,
  ok,
  outcomeColumns,
  persistBlockedLedger,
  withMappingTransaction,
} from "./persist";
import type {
  AppendMappingInput,
  AppendMappingResult,
  MappingHead,
  MappingOutcome,
  MappingResult,
  MappingVersion,
  ReadMappingHeadInput,
  RewriteMappingVersionInput,
} from "./types";
import { MAPPING_TARGET_KINDS } from "./types";

export const rewriteMappingVersion = async (
  _input: RewriteMappingVersionInput,
): Promise<MappingResult<never>> =>
  fail("PCAT-MAP-APPEND-ONLY", "Mapping versions are append-only; in-place UPDATE is refused");

const requireChecksum = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed !== value) return null;
  return trimmed;
};

const validateOutcome = (outcome: MappingOutcome): MappingResult<MappingOutcome> => {
  if (outcome.kind === "operational") {
    if (!MAPPING_TARGET_KINDS.includes(outcome.targetKind)) {
      return fail("PCAT-MAP-TARGET-INCOMPATIBLE", `Unknown target kind ${outcome.targetKind}`);
    }
    const targetId = requireChecksum(outcome.targetId);
    if (!targetId) {
      return fail("PCAT-MAP-TARGET-INCOMPATIBLE", "Operational mapping requires a trimmed target id");
    }
    if (outcome.evidenceArchiveId !== undefined && requireChecksum(outcome.evidenceArchiveId) === null) {
      return fail("PCAT-MAP-TARGET-INCOMPATIBLE", "evidence archive id must be trimmed");
    }
    return ok(outcome);
  }
  const archiveId = requireChecksum(outcome.archiveId);
  if (!archiveId) {
    return fail("PCAT-MAP-TARGET-INCOMPATIBLE", "Archived mapping requires a trimmed archive id");
  }
  if (outcome.evidenceArchiveId !== undefined) {
    if (requireChecksum(outcome.evidenceArchiveId) === null) {
      return fail("PCAT-MAP-TARGET-INCOMPATIBLE", "evidence archive id must be trimmed");
    }
    if (outcome.evidenceArchiveId === archiveId) {
      return fail(
        "PCAT-MAP-TARGET-INCOMPATIBLE",
        "evidence archive id must be distinct from archive id",
      );
    }
  }
  return ok(outcome);
};

const assignmentForIdentity = (
  assignments: readonly ClassificationAssignment[],
  identityId: string,
): ClassificationAssignment | undefined =>
  assignments.find((assignment) => assignment.identityId === identityId);

const buildVersion = (input: {
  identityId: string;
  cutoverRunId: string;
  versionNumber: number;
  sourceChecksum: string;
  graphFingerprint: string;
  assignment: ClassificationAssignment;
  outcome: MappingOutcome;
  supersedesVersionId: string | null;
}): MappingVersion => {
  const columns = outcomeColumns(input.outcome);
  return {
    id: mintMappingVersionId(),
    legacyIdentityId: input.identityId,
    cutoverRunId: input.cutoverRunId,
    versionNumber: input.versionNumber,
    sourceChecksum: input.sourceChecksum,
    graphFingerprint: input.graphFingerprint,
    rClass: input.assignment.rClass,
    targetKind: columns.targetKind,
    targetId: columns.targetId,
    archiveId: columns.archiveId,
    evidenceArchiveId: columns.evidenceArchiveId,
    supersedesVersionId: input.supersedesVersionId,
  };
};

const headFromVersion = (version: MappingVersion, casVersion: number): MappingHead => ({
  legacyIdentityId: version.legacyIdentityId,
  currentVersionId: version.id,
  casVersion,
  version,
});

export const appendMappingVersion = async (
  input: AppendMappingInput,
): Promise<MappingResult<AppendMappingResult>> => {
  const sourceChecksum = requireChecksum(input.sourceChecksum);
  if (!sourceChecksum) {
    return fail("PCAT-MAP-WRITE-FAILED", "source checksum must be non-empty and trimmed");
  }
  const outcomeResult = validateOutcome(input.outcome);
  if (!outcomeResult.ok) return outcomeResult;

  return withMappingTransaction(input.client, async () => {
    await lockMappingIdentity(input.client, input.identityId);
    const stored = await loadStoredIdentity(input.client, input.identityId, true);
    if (!stored) {
      return fail("PCAT-MAP-UNKNOWN-IDENTITY", `Legacy identity ${input.identityId} does not exist`);
    }

    const assignment = assignmentForIdentity(input.classification.assignments, input.identityId);
    if (!assignment) {
      return fail(
        "PCAT-MAP-CLASSIFICATION-GAP",
        `Frozen classification omitted identity ${input.identityId}`,
      );
    }
    if (
      assignment.sourceKind !== stored.source_kind ||
      assignment.sourceId !== stored.source_id ||
      assignment.ownerScopeKind !== stored.owner_scope_kind ||
      assignment.ownerScopeId !== stored.owner_scope_id
    ) {
      return fail(
        "PCAT-MAP-CLASSIFICATION-GAP",
        `Frozen classification does not match stored identity ${input.identityId}`,
      );
    }

    if (assignment.rClass === "R0") {
      await persistBlockedLedger(input.client, {
        cutoverRunId: input.cutoverRunId,
        identityId: input.identityId,
        classifierVersion: input.classification.classifierVersion,
        graphFingerprint: input.classification.graphFingerprint,
      });
      const blocker = input.classification.blockers.find(
        (row) => row.identityId === input.identityId,
      );
      return ok({
        status: "blocked" as const,
        identityId: input.identityId,
        rClass: "R0" as const,
        invariant: blocker?.invariant ?? "contradictory-or-cross-owner-graph",
      });
    }

    const headCount = await countMappingHeads(input.client, input.identityId);
    if (headCount > 1) {
      return fail("PCAT-MAP-CONFLICT", `Ambiguous mapping heads for ${input.identityId}`);
    }

    const currentResult = await loadMappingHead(input.client, input.identityId, true);
    if (!currentResult.ok) return currentResult;
    const current = currentResult.value;

    if (
      current &&
      isExactReplay(current.version, {
        sourceChecksum,
        graphFingerprint: input.classification.graphFingerprint,
        rClass: assignment.rClass,
        outcome: input.outcome,
      })
    ) {
      return ok({ status: "replayed" as const, head: current });
    }

    if (!current) {
      if (input.expectedHead !== null) {
        return fail("PCAT-MAP-CONFLICT", "CAS mismatch: no current mapping head");
      }
      const version = buildVersion({
        identityId: input.identityId,
        cutoverRunId: input.cutoverRunId,
        versionNumber: 1,
        sourceChecksum,
        graphFingerprint: input.classification.graphFingerprint,
        assignment,
        outcome: input.outcome,
        supersedesVersionId: null,
      });
      await insertMappingVersion(input.client, version);
      await insertMappingHead(input.client, input.identityId, version.id);
      return ok({ status: "appended" as const, head: headFromVersion(version, 1) });
    }

    if (
      input.expectedHead === null ||
      input.expectedHead.casVersion !== current.casVersion ||
      input.expectedHead.versionId !== current.currentVersionId
    ) {
      return fail("PCAT-MAP-CONFLICT", "CAS mismatch: refusing to overwrite the current mapping head");
    }

    const versionNumber = await nextVersionNumber(input.client, input.identityId);
    const supersedesVersionId =
      current.version.cutoverRunId === input.cutoverRunId ? current.version.id : null;
    const version = buildVersion({
      identityId: input.identityId,
      cutoverRunId: input.cutoverRunId,
      versionNumber,
      sourceChecksum,
      graphFingerprint: input.classification.graphFingerprint,
      assignment,
      outcome: input.outcome,
      supersedesVersionId,
    });
    await insertMappingVersion(input.client, version);
    const advanced = await casMappingHead(input.client, {
      identityId: input.identityId,
      nextVersionId: version.id,
      expectedVersionId: current.currentVersionId,
      expectedCasVersion: current.casVersion,
    });
    if (!advanced) {
      return fail("PCAT-MAP-CONFLICT", "CAS mismatch while advancing the mapping head");
    }
    return ok({
      status: "appended" as const,
      head: headFromVersion(version, current.casVersion + 1),
    });
  });
};

export const readCurrentMappingHead = async (
  input: ReadMappingHeadInput,
): Promise<MappingResult<MappingHead>> => {
  const stored = await loadStoredIdentity(input.client, input.identityId, false);
  if (!stored) {
    return fail("PCAT-MAP-UNKNOWN-IDENTITY", `Legacy identity ${input.identityId} does not exist`);
  }
  const headCount = await countMappingHeads(input.client, input.identityId);
  if (headCount > 1) {
    return fail("PCAT-MAP-CONFLICT", `Ambiguous mapping heads for ${input.identityId}`);
  }
  const current = await loadMappingHead(input.client, input.identityId, false);
  if (!current.ok) return current;
  if (!current.value) {
    return fail("PCAT-MAP-UNMAPPED", `Legacy identity ${input.identityId} has no mapping head`);
  }
  return ok(current.value);
};
