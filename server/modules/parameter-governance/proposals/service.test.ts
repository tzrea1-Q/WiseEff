import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalId,
  DefinitionRevisionId,
  ParameterDefinitionId,
} from "../../parameter-catalog-contract/index";

import {
  createAndSubmitCommandKind,
  createDraftCommandKind,
  fingerprintProposalCommand,
  proposalCommandFamily,
  proposalIdempotencyIdentity,
  submitExistingCommandKind,
  validateProposalCommand,
  type AcceptProposalCommand,
  type CreateDraftProposalCommand,
  type SubmitExistingProposalCommand,
  type SubmitProposalCommand,
  type WithdrawProposalCommand,
} from "./command";
import { THREAT_MATRIX } from "./threatMatrix";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = [
  "command.ts",
  "result.ts",
  "failures.ts",
  "service.ts",
  "unitOfWork.ts",
  "repositories.ts",
  "audit.ts",
  "writer.ts",
  "index.ts",
  "threatMatrix.ts",
] as const;

const catalogMentionForbidden = [
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  "parameter_definitions",
  "catalog_materializations",
] as const;

const allowedCatalogIdentifiers = new Set([
  "definition_proposals",
  "definition_proposal_revisions",
  "catalog_publication_intents",
  "governance_command_idempotency",
  "catalog_releases",
  "catalog_state",
  "definition_revisions",
  "catalog_release_definition_heads",
]);

const catalogWriteForbidden = [
  "catalog_releases",
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  "parameter_definitions",
  "definition_revisions",
  "catalog_release_definition_heads",
  "catalog_materializations",
  "catalog_state",
] as const;

const pin = {
  id: CatalogReleaseId("crel_acme_1"),
  digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
};

const successorPin = {
  id: CatalogReleaseId("crel_acme_2"),
  digest: CatalogReleaseDigest(`sha256:${"b".repeat(64)}`),
};

const submitCommand = (
  overrides: Partial<SubmitProposalCommand> = {},
): SubmitProposalCommand => ({
  kind: "submit",
  organizationId: "org-s5-prp",
  baseRelease: pin,
  currentRelease: pin,
  baseDefinitionRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  payload: { change: "raise-limit", note: "stable" },
  reason: "field measurement requires a higher limit",
  evidenceRefs: ["evidence:stable"],
  idempotencyKey: "proposal-key-1",
  context: { actorKind: "org-admin", principalId: "user-org-admin-proposer" },
  ...overrides,
});

const withdrawCommand = (
  overrides: Partial<WithdrawProposalCommand> = {},
): WithdrawProposalCommand => ({
  kind: "withdraw",
  organizationId: "org-s5-prp",
  proposalId: DefinitionProposalId("dprop_stable"),
  expectedEtag: 1,
  idempotencyKey: "withdraw-key-1",
  context: { actorKind: "org-admin", principalId: "user-org-admin-proposer" },
  ...overrides,
});

const acceptCommand = (
  overrides: Partial<AcceptProposalCommand> = {},
): AcceptProposalCommand => ({
  kind: "accept",
  organizationId: "org-s5-prp",
  proposalId: DefinitionProposalId("dprop_stable"),
  expectedEtag: 1,
  currentRelease: pin,
  repositoryReference: "repo://wiseeff-catalog/schemas/dts/vendor/acme-power.yaml",
  idempotencyKey: "accept-key-1",
  context: { actorKind: "platform-admin", principalId: "user-platform-admin-reviewer" },
  ...overrides,
});

const createDraftCommand = (
  overrides: Partial<CreateDraftProposalCommand> = {},
): CreateDraftProposalCommand => ({
  kind: "create-draft",
  organizationId: "org-s5-prp",
  baseRelease: pin,
  currentRelease: pin,
  claimedBaseReleaseId: pin.id,
  baseDefinitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
  baseDefinitionRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  payload: { change: "raise-limit", note: "stable" },
  reason: "field measurement requires a higher limit",
  evidenceRefs: ["evidence:stable"],
  idempotencyKey: "draft-key-1",
  context: { actorKind: "org-admin", principalId: "user-org-admin-proposer" },
  ...overrides,
});

const submitExistingCommand = (
  overrides: Partial<SubmitExistingProposalCommand> = {},
): SubmitExistingProposalCommand => ({
  kind: "submit-existing",
  organizationId: "org-s5-prp",
  proposalId: DefinitionProposalId("dprop_stable"),
  expectedEtag: 1,
  currentRelease: pin,
  idempotencyKey: "submit-existing-key-1",
  context: { actorKind: "org-admin", principalId: "user-org-admin-proposer" },
  ...overrides,
});

describe("S5-PRP public command contract", () => {
  it("owns the frozen command family and threat-matrix coverage", () => {
    expect(proposalCommandFamily).toBe("definition-proposal");
    expect(createAndSubmitCommandKind).toBe("submit");
    expect(createDraftCommandKind).toBe("create-draft");
    expect(submitExistingCommandKind).toBe("submit-existing");
    expect(THREAT_MATRIX).toHaveLength(9);
  });

  it("fingerprints canonical payload key order identically", () => {
    const first = fingerprintProposalCommand(
      submitCommand({ payload: { note: "stable", change: "raise-limit" } }),
    );
    const second = fingerprintProposalCommand(
      submitCommand({ payload: { change: "raise-limit", note: "stable" } }),
    );
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("refuses submit from a Platform Admin reviewer", () => {
    const result = validateProposalCommand(
      submitCommand({
        context: { actorKind: "platform-admin", principalId: "user-platform-admin-reviewer" },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "permission-denied",
        actorKind: "platform-admin",
        method: "submit",
      },
    });
  });

  it("refuses withdraw by a reviewer role", () => {
    const result = validateProposalCommand(
      withdrawCommand({
        context: { actorKind: "platform-admin", principalId: "user-platform-admin-reviewer" },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "permission-denied",
        actorKind: "platform-admin",
        method: "withdraw",
      },
    });
  });

  it("refuses accept from the Org Admin proposer role", () => {
    const result = validateProposalCommand(
      acceptCommand({
        context: { actorKind: "org-admin", principalId: "user-org-admin-proposer" },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "permission-denied",
        actorKind: "org-admin",
        method: "accept",
      },
    });
  });

  it("maps a stale captured base revision to proposal-stale", () => {
    const result = validateProposalCommand(
      submitCommand({
        baseRelease: pin,
        currentRelease: successorPin,
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "proposal-stale",
        capturedRelease: pin,
        currentRelease: successorPin,
      },
    });
  });

  it("CATFIX-PROP-13: submit-existing takes a Proposal ID and rejects a wrapped DefinitionRevisionId field", () => {
    const existing: SubmitExistingProposalCommand = submitExistingCommand();
    expect(existing.kind).toBe("submit-existing");
    expect(existing).not.toHaveProperty("baseDefinitionRevisionId");
    expect(existing).not.toHaveProperty("payload");
    const adapter: SubmitProposalCommand = submitCommand();
    expect(adapter.kind).toBe("submit");
    expect(adapter).not.toHaveProperty("proposalId");
    const revisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");
    const proposalId = DefinitionProposalId("dprop_stable");
    expect(proposalId).not.toBe(revisionId);
    expect(
      validateProposalCommand(
        submitExistingCommand({ proposalId: DefinitionProposalId(String(revisionId)) }),
      ).ok,
    ).toBe(true);
    expect(proposalIdempotencyIdentity(existing).family).toBe(
      "definition-proposal:submit-existing",
    );
    expect(proposalIdempotencyIdentity(adapter).family).toBe("definition-proposal");
    expect(proposalIdempotencyIdentity(createDraftCommand()).family).toBe(
      "definition-proposal:create-draft",
    );
  });

  it("CATFIX-PROP-15: create-draft keeps a new-definition branch without a fake revision id", () => {
    const result = validateProposalCommand(
      createDraftCommand({
        baseDefinitionId: null,
        baseDefinitionRevisionId: null,
      }),
    );
    expect(result.ok).toBe(true);
    const xor = validateProposalCommand(
      createDraftCommand({
        baseDefinitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
        baseDefinitionRevisionId: null,
      }),
    );
    expect(xor).toEqual({
      ok: false,
      error: { kind: "invalid-command", reason: "baseDefinitionRevisionId" },
    });
  });

  it("refuses create-draft when the claimed HTTP base release does not match the captured pin", () => {
    const result = validateProposalCommand(
      createDraftCommand({ claimedBaseReleaseId: successorPin.id }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "proposal-stale",
        capturedRelease: pin,
        currentRelease: pin,
      },
    });
  });

  it("refuses submit-existing from a Platform Admin reviewer", () => {
    const result = validateProposalCommand(
      submitExistingCommand({
        context: { actorKind: "platform-admin", principalId: "user-platform-admin-reviewer" },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "permission-denied",
        actorKind: "platform-admin",
        method: "submit-existing",
      },
    });
  });
});

describe("S5-PRP production Catalog isolation", () => {
  it("never writes Catalog structural rows and never installs a release", () => {
    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    const writePattern = new RegExp(
      `\\b(?:insert\\s+into|update|delete\\s+from)\\s+parameter_catalog\\.(?:${catalogWriteForbidden.join("|")})\\b`,
      "i",
    );
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("parameter_definitions");
      expect(source, file).not.toMatch(/pg_advisory_xact_lock\(/);
      expect(source, file).not.toMatch(/pg_advisory_lock\b/);
      expect(source, file).not.toMatch(/\bresolveReviewItem\b/);
      expect(source, file).not.toMatch(/installPublishedRelease/);
      expect(source, file).not.toMatch(/catalog-kernel/);
      expect(source, file).not.toMatch(/parameter-governance\/registration/);
      expect(source, file).not.toMatch(writePattern);
      for (const token of catalogMentionForbidden) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
      const identifiers = [...source.matchAll(/parameter_catalog\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (match) => match[1],
      );
      for (const identifier of identifiers) {
        expect(allowedCatalogIdentifiers.has(identifier), `${file} -> ${identifier}`).toBe(true);
      }
    }
  });
});
