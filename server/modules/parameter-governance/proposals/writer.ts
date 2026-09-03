import { randomUUID } from "node:crypto";

import {
  CatalogReleaseId,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  PublicationIntentId,
} from "../../parameter-catalog-contract/index";

import type {
  AcceptProposalCommand,
  ProposalCommand,
  RejectProposalCommand,
  SubmitProposalCommand,
  WithdrawProposalCommand,
} from "./command";
import { fingerprintProposalCommand } from "./command";
import { writeSuccessAudit } from "./audit";
import type { ProposalFailure } from "./failures";
import type { ProposalResult, PublicationIntentResult, Result } from "./result";
import {
  commitIdempotency,
  insertProposal,
  insertProposalRevision,
  insertPublicationIntent,
  loadProposalById,
  loadPublicationIntent,
  loadRevision,
  reserveIdempotency,
  updateProposalStatus,
  type ProposalRevisionRow,
  type ProposalRow,
  type ProposalWriterClient,
  type PublicationIntentRow,
} from "./repositories";

export type { ProposalWriterClient };

const fail = (error: ProposalFailure): Result<never, ProposalFailure> => ({
  ok: false,
  error,
});

const asJson = (value: unknown): string => JSON.stringify(value);

const etagOf = (row: ProposalRow): number => Number(row.etag_version);

const intentResult = (row: PublicationIntentRow): PublicationIntentResult => ({
  id: PublicationIntentId(row.id),
  repositoryReference: row.repository_reference,
  reviewerPrincipalId: row.reviewer_principal_id,
  successAuditRef: row.success_audit_ref,
});

const toResult = (
  proposal: ProposalRow,
  revision: ProposalRevisionRow,
  command: ProposalCommand,
  fingerprint: string,
  outcome: ProposalResult["outcome"],
  publicationIntent: PublicationIntentResult | null,
): ProposalResult => ({
  outcome,
  proposalId: DefinitionProposalId(proposal.id),
  proposalRevisionId: DefinitionProposalRevisionId(revision.id),
  revisionNumber: Number(revision.revision_number),
  status: proposal.status,
  etagVersion: etagOf(proposal),
  organizationId: proposal.organization_id,
  baseCatalogReleaseId: proposal.base_catalog_release_id,
  baseDefinitionRevisionId: proposal.base_definition_revision_id,
  fingerprint,
  idempotencyKey: command.idempotencyKey,
  publicationIntent,
});

const loadResultBundle = async (
  client: ProposalWriterClient,
  organizationId: string,
  proposalId: string,
): Promise<{
  proposal: ProposalRow;
  revision: ProposalRevisionRow;
  intent: PublicationIntentRow | null;
} | null> => {
  const proposal = await loadProposalById(client, organizationId, proposalId);
  if (!proposal) return null;
  const revision = await loadRevision(
    client,
    proposal.id,
    proposal.current_proposal_revision_id,
  );
  if (!revision) return null;
  const intent = await loadPublicationIntent(client, proposal.id);
  return { proposal, revision, intent };
};

const replayStored = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
  fingerprint: string,
  proposalId: string,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const stored = await loadResultBundle(client, command.organizationId, proposalId);
  if (!stored) {
    return fail({ kind: "proposal-not-found", proposalId });
  }
  return {
    ok: true,
    value: toResult(
      stored.proposal,
      stored.revision,
      command,
      fingerprint,
      "replayed",
      stored.intent ? intentResult(stored.intent) : null,
    ),
  };
};

const etagConflict = (
  command: Exclude<ProposalCommand, SubmitProposalCommand>,
  stored: ProposalRow,
): Result<never, ProposalFailure> =>
  fail({
    kind: "revision-conflict",
    idempotencyKey: command.idempotencyKey,
    storedFingerprint: `etag:${etagOf(stored)}`,
    attemptedFingerprint: `etag:${command.expectedEtag}`,
  });

const writeSubmit = async (
  client: ProposalWriterClient,
  command: SubmitProposalCommand,
  fingerprint: string,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const proposalId = `dprop_${randomUUID()}`;
  const revisionId = `dprev_${randomUUID()}`;
  const proposal = await insertProposal(client, {
    id: proposalId,
    organizationId: command.organizationId,
    authorPrincipalId: command.context.principalId,
    baseCatalogReleaseId: command.baseRelease.id,
    baseDefinitionRevisionId: command.baseDefinitionRevisionId,
    currentProposalRevisionId: revisionId,
  });
  const revision = await insertProposalRevision(client, {
    id: revisionId,
    proposalId,
    payload: asJson(command.payload),
    reason: command.reason,
    evidenceRefs: asJson(command.evidenceRefs),
  });
  await writeSuccessAudit(client, command, proposalId, fingerprint);
  await commitIdempotency(client, command, proposalId);
  return {
    ok: true,
    value: toResult(proposal, revision, command, fingerprint, "committed", null),
  };
};

const requireProposal = async (
  client: ProposalWriterClient,
  command: Exclude<ProposalCommand, SubmitProposalCommand>,
): Promise<Result<{ proposal: ProposalRow; revision: ProposalRevisionRow }, ProposalFailure>> => {
  const stored = await loadResultBundle(
    client,
    command.organizationId,
    command.proposalId,
  );
  if (!stored) {
    return fail({ kind: "proposal-not-found", proposalId: command.proposalId });
  }
  if (etagOf(stored.proposal) !== command.expectedEtag) {
    return etagConflict(command, stored.proposal);
  }
  return { ok: true, value: { proposal: stored.proposal, revision: stored.revision } };
};

const writeWithdraw = async (
  client: ProposalWriterClient,
  command: WithdrawProposalCommand,
  fingerprint: string,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const loaded = await requireProposal(client, command);
  if (!loaded.ok) return loaded;
  const { proposal, revision } = loaded.value;
  if (proposal.author_principal_id !== command.context.principalId) {
    return fail({
      kind: "permission-denied",
      actorKind: command.context.actorKind,
      method: command.kind,
    });
  }
  if (proposal.status !== "draft" && proposal.status !== "submitted") {
    return fail({
      kind: "invalid-transition",
      from: proposal.status,
      attempted: "withdrawn",
    });
  }
  const updated = await updateProposalStatus(
    client,
    proposal.id,
    "withdrawn",
    etagOf(proposal) + 1,
  );
  await writeSuccessAudit(client, command, proposal.id, fingerprint);
  await commitIdempotency(client, command, proposal.id);
  return {
    ok: true,
    value: toResult(updated, revision, command, fingerprint, "committed", null),
  };
};

const writeAccept = async (
  client: ProposalWriterClient,
  command: AcceptProposalCommand,
  fingerprint: string,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const loaded = await requireProposal(client, command);
  if (!loaded.ok) return loaded;
  const { proposal, revision } = loaded.value;
  if (proposal.author_principal_id === command.context.principalId) {
    return fail({
      kind: "proposal-self-approval-forbidden",
      authorPrincipalId: proposal.author_principal_id,
      reviewerPrincipalId: command.context.principalId,
    });
  }
  if (proposal.base_catalog_release_id !== command.currentRelease.id) {
    return fail({
      kind: "proposal-stale",
      capturedRelease: {
        id: CatalogReleaseId(proposal.base_catalog_release_id),
        digest: command.currentRelease.digest,
      },
      currentRelease: command.currentRelease,
    });
  }
  if (proposal.status !== "submitted") {
    return fail({
      kind: "invalid-transition",
      from: proposal.status,
      attempted: "accepted",
    });
  }
  const successAuditRef = await writeSuccessAudit(client, command, proposal.id, fingerprint);
  const intent = await insertPublicationIntent(client, {
    id: `cpint_${randomUUID()}`,
    proposalId: proposal.id,
    proposalRevisionId: revision.id,
    baseCatalogReleaseId: proposal.base_catalog_release_id,
    repositoryReference: command.repositoryReference,
    reviewerPrincipalId: command.context.principalId,
    successAuditRef,
  });
  const updated = await updateProposalStatus(
    client,
    proposal.id,
    "accepted",
    etagOf(proposal) + 1,
  );
  await commitIdempotency(client, command, proposal.id);
  return {
    ok: true,
    value: toResult(
      updated,
      revision,
      command,
      fingerprint,
      "committed",
      intentResult(intent),
    ),
  };
};

const writeReject = async (
  client: ProposalWriterClient,
  command: RejectProposalCommand,
  fingerprint: string,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const loaded = await requireProposal(client, command);
  if (!loaded.ok) return loaded;
  const { proposal, revision } = loaded.value;
  if (proposal.author_principal_id === command.context.principalId) {
    return fail({
      kind: "proposal-self-approval-forbidden",
      authorPrincipalId: proposal.author_principal_id,
      reviewerPrincipalId: command.context.principalId,
    });
  }
  if (proposal.base_catalog_release_id !== command.currentRelease.id) {
    return fail({
      kind: "proposal-stale",
      capturedRelease: {
        id: CatalogReleaseId(proposal.base_catalog_release_id),
        digest: command.currentRelease.digest,
      },
      currentRelease: command.currentRelease,
    });
  }
  if (proposal.status !== "submitted") {
    return fail({
      kind: "invalid-transition",
      from: proposal.status,
      attempted: "rejected",
    });
  }
  const updated = await updateProposalStatus(
    client,
    proposal.id,
    "rejected",
    etagOf(proposal) + 1,
  );
  await writeSuccessAudit(client, command, proposal.id, fingerprint);
  await commitIdempotency(client, command, proposal.id);
  return {
    ok: true,
    value: toResult(updated, revision, command, fingerprint, "committed", null),
  };
};

export const writeProposal = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const fingerprint = fingerprintProposalCommand(command);
  const reserved = await reserveIdempotency(client, command, fingerprint);
  if (reserved.request_fingerprint !== fingerprint) {
    return fail({
      kind: "revision-conflict",
      idempotencyKey: command.idempotencyKey,
      storedFingerprint: reserved.request_fingerprint,
      attemptedFingerprint: fingerprint,
    });
  }
  if (reserved.state === "committed" && reserved.result_ref) {
    return replayStored(client, command, fingerprint, reserved.result_ref);
  }
  switch (command.kind) {
    case "submit":
      return writeSubmit(client, command, fingerprint);
    case "withdraw":
      return writeWithdraw(client, command, fingerprint);
    case "accept":
      return writeAccept(client, command, fingerprint);
    case "reject":
      return writeReject(client, command, fingerprint);
  }
};
