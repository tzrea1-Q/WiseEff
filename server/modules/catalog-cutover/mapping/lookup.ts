import {
  countMappingHeads,
  fail,
  loadBlockedLedger,
  loadIdentityIdBySourceTuple,
  loadMappingHead,
  loadStoredIdentity,
  ok,
} from "./persist";
import type {
  LookupProtectedIdentityInput,
  MappingResult,
  ProtectedLookupResult,
} from "./types";

export const lookupProtectedIdentity = async (
  input: LookupProtectedIdentityInput,
): Promise<MappingResult<ProtectedLookupResult>> => {
  const identityId =
    input.identity.kind === "legacy-identity-id"
      ? input.identity.id
      : await loadIdentityIdBySourceTuple(input.client, input.identity);
  if (!identityId) {
    return fail("PCAT-MAP-UNKNOWN-IDENTITY", "Protected identity does not exist");
  }

  const stored = await loadStoredIdentity(input.client, identityId, false);
  if (!stored) {
    return fail("PCAT-MAP-UNKNOWN-IDENTITY", `Legacy identity ${identityId} does not exist`);
  }

  const headCount = await countMappingHeads(input.client, identityId);
  if (headCount > 1) {
    return fail("PCAT-MAP-CONFLICT", `Ambiguous mapping heads for ${identityId}`);
  }

  const current = await loadMappingHead(input.client, identityId, false);
  if (!current.ok) return current;
  if (current.value) {
    const version = current.value.version;
    if (version.targetKind !== null && version.targetId !== null && version.archiveId === null) {
      return ok({
        outcome: "mapped",
        head: current.value,
        targetKind: version.targetKind,
        targetId: version.targetId,
      });
    }
    if (version.targetKind === null && version.targetId === null && version.archiveId !== null) {
      return ok({
        outcome: "archived",
        head: current.value,
        archiveId: version.archiveId,
      });
    }
    return fail("PCAT-MAP-WRITE-FAILED", `Mapping version ${version.id} violates the target CHECK`);
  }

  if (await loadBlockedLedger(input.client, identityId)) {
    return ok({
      outcome: "blocked",
      identityId,
      rClass: "R0",
    });
  }

  return fail("PCAT-MAP-UNMAPPED", `Legacy identity ${identityId} has no mapping head`);
};
