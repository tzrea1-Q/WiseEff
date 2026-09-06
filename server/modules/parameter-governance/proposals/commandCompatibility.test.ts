import { describe, expect, it } from "vitest";

import { CatalogReleaseDigest, CatalogReleaseId, DefinitionProposalId } from "../../parameter-catalog-contract/index";
import { fingerprintProposalCommand, proposalIdempotencyIdentity, type SubmitExistingProposalCommand } from "./command";

const command: SubmitExistingProposalCommand = {
  kind: "submit-existing", organizationId: "org-r2", proposalId: DefinitionProposalId("dprop-r2"),
  expectedEtag: 1, currentRelease: { id: CatalogReleaseId("crel-r2"), digest: CatalogReleaseDigest("sha256:r2") },
  context: { actorKind: "org-admin", principalId: "user-r2" }, idempotencyKey: "key-r2",
};

describe("R2 Proposal fingerprint compatibility", () => {
  it("preserves historical undefined-reason canonical bytes and includes explicitly supplied reason", () => {
    // Independently declared SHA-256 of pre-R2 sorted, two-space JSON plus newline.
    const historical = "sha256:d2c2c577f96707be53b5aa2463b7ed0f56d0fa107e959ace2043d66049a2b529";
    expect(fingerprintProposalCommand(command)).toBe(historical);
    expect(fingerprintProposalCommand({ ...command, reason: undefined })).toBe(historical);
    expect(fingerprintProposalCommand({ ...command, reason: "" })).not.toBe(historical);
    expect(fingerprintProposalCommand({ ...command, reason: "first" })).not.toBe(fingerprintProposalCommand({ ...command, reason: "second" }));
  });

  it("binds the complete target and key semantics even when legacy storage delimiters collide", () => {
    const left = { ...command, proposalId: DefinitionProposalId("dprop-r2:a"), idempotencyKey: "b" };
    const right = { ...command, proposalId: DefinitionProposalId("dprop-r2"), idempotencyKey: "a:b" };
    // Keep legacy storage identity compatible; a collision must conflict, never replay another target.
    expect(proposalIdempotencyIdentity(left)).toEqual(proposalIdempotencyIdentity(right));
    expect(fingerprintProposalCommand(left)).not.toBe(fingerprintProposalCommand(right));
  });
});
