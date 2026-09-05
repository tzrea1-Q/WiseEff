import { randomUUID } from "node:crypto";

import {
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  PublicationIntentId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";

import type {
  AcceptProposalCommand,
  CreateDraftProposalCommand,
  ProposalCommand,
  RejectProposalCommand,
  SubmitExistingProposalCommand,
  SubmitProposalCommand,
  WithdrawProposalCommand,
} from "./command";
import { fingerprintProposalCommand } from "./command";
import { writeSuccessAudit } from "./audit";
import type { ProposalFailure } from "./failures";
import type {
  ProposalResult,
  ProposalResultSnapshot,
  PublicationIntentResult,
  Result,
} from "./result";
import {
  assertReleasePinExists,
  assertRevisionVisibleInRelease,
  commitIdempotency,
  insertProposal,
  insertProposalRevision,
  insertPublicationIntent,
  intentResult,
  loadProposalById,
  loadPublicationIntent,
  loadReleasePin,
  loadRevision,
  loadSuccessAuditSnapshot,
  lockAndLoadCurrentRelease,
  reserveIdempotency,
  updateProposalStatus,
  type ProposalRevisionRow,
  type ProposalRow,
  type ProposalWriterClient,
  type PublicationIntentRow,
} from "./repositories";

export type { ProposalWriterClient };

export type ProposalWriterTestHooks = {
  afterStatusBeforeSuccessAudit?: () => Promise<void> | void;
};

let testHooks: ProposalWriterTestHooks | null = null;

export const setProposalWriterTestHooks = (
  hooks: ProposalWriterTestHooks | null,
): void => {
  testHooks = hooks;
};

const fail = (error: ProposalFailure): Result<never, ProposalFailure> => ({
  ok: false,
  error,
});

const asJson = (value: unknown): string => JSON.stringify(value);

const etagOf = (row: ProposalRow): number => Number(row.etag_version);

const pinsEqual = (left: CatalogReleasePin, right: CatalogReleasePin): boolean =>
  left.id === right.id && left.digest === right.digest;

const snapshotOf = (
  proposal: ProposalRow,
  revision: ProposalRevisionRow,
  publicationIntent: PublicationIntentResult | null,
): ProposalResultSnapshot => ({
  proposalId: DefinitionProposalId(proposal.id),
  proposalRevisionId: DefinitionProposalRevisionId(revision.id),
  revisionNumber: Number(revision.revision_number),
  status: proposal.status,
  etagVersion: etagOf(proposal),
  organizationId: proposal.organization_id,
  baseCatalogReleaseId: proposal.base_catalog_release_id,
  baseDefinitionRevisionId: proposal.base_definition_revision_id,
  publicationIntent,
});

const toResult = (
  snapshot: ProposalResultSnapshot,
  command: ProposalCommand,
  fingerprint: string,
  outcome: ProposalResult["outcome"],
): ProposalResult => ({
  ...snapshot,
  outcome,
  fingerprint,
  idempotencyKey: command.idempotencyKey,
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
  const snapshot = await loadSuccessAuditSnapshot(
    client,
    command.organizationId,
    `proposal-${command.kind}`,
    fingerprint,
    proposalId,
  );
  if (snapshot) {
    return {
      ok: true,
      value: toResult(snapshot, command, fingerprint, "replayed"),
    };
  }
  const stored = await loadResultBundle(client, command.organizationId, proposalId);
  if (!stored) {
    return fail({ kind: "proposal-not-found", proposalId });
  }
  return {
    ok: true,
    value: toResult(
      snapshotOf(
        stored.proposal,
        stored.revision,
        stored.intent ? intentResult(stored.intent) : null,
      ),
      command,
      fingerprint,
      "replayed",
    ),
  };
};

const etagConflict = (
  command: Extract<
    ProposalCommand,
    { expectedEtag: number; idempotencyKey: string }
  >,
  stored: ProposalRow,
): Result<never, ProposalFailure> =>
  fail({
    kind: "revision-conflict",
    idempotencyKey: command.idempotencyKey,
    storedFingerprint: `etag:${etagOf(stored)}`,
    attemptedFingerprint: `etag:${command.expectedEtag}`,
  });

const stale = (
  captured: CatalogReleasePin,
  current: CatalogReleasePin,
): Result<never, ProposalFailure> =>
  fail({ kind: "proposal-stale", capturedRelease: captured, currentRelease: current });

const requireLivePin = (
  claimed: CatalogReleasePin,
  live: CatalogReleasePin,
  captured: CatalogReleasePin = claimed,
): Result<true, ProposalFailure> => {
  if (!pinsEqual(claimed, live)) {
    return stale(captured, live);
  }
  return { ok: true, value: true };
};

const requireProposal = async (
  client: ProposalWriterClient,
  command: Extract<ProposalCommand, { proposalId: string; expectedEtag: number }>,
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

const commitStatus = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
  proposal: ProposalRow,
  revision: ProposalRevisionRow,
  fingerprint: string,
  status: ProposalRow["status"],
  publicationIntent: PublicationIntentResult | null,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const currentEtag = etagOf(proposal);
  const updated = await updateProposalStatus(
    client,
    proposal.id,
    status,
    currentEtag,
    currentEtag + 1,
  );
  if (!updated) {
    return fail({
      kind: "revision-conflict",
      idempotencyKey: command.idempotencyKey,
      storedFingerprint: `etag:${currentEtag}`,
      attemptedFingerprint: `etag:${currentEtag}`,
    });
  }
  await testHooks?.afterStatusBeforeSuccessAudit?.();
  const snapshot = snapshotOf(updated, revision, publicationIntent);
  await writeSuccessAudit(client, command, updated.id, fingerprint, snapshot);
  await commitIdempotency(client, command, updated.id);
  return { ok: true, value: toResult(snapshot, command, fingerprint, "committed") };
};

const writeCreatedProposal = async (
  client: ProposalWriterClient,
  command: CreateDraftProposalCommand | SubmitProposalCommand,
  fingerprint: string,
  live: CatalogReleasePin,
  status: "draft" | "submitted",
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const liveCheck = requireLivePin(command.currentRelease, live, command.baseRelease);
  if (!liveCheck.ok) return liveCheck;
  if (!pinsEqual(command.baseRelease, live)) {
    return stale(command.baseRelease, live);
  }
  if (command.kind === "create-draft" && command.claimedBaseReleaseId) {
    if (command.claimedBaseReleaseId !== command.baseRelease.id) {
      return stale(command.baseRelease, live);
    }
  }
  const release = await assertReleasePinExists(client, command.baseRelease);
  if (!release.ok) return release;

  let baseDefinitionRevisionId: string | null = null;
  if (command.kind === "submit") {
    const visible = await assertRevisionVisibleInRelease(
      client,
      command.baseRelease.id,
      command.baseDefinitionRevisionId,
    );
    if (!visible.ok) return visible;
    baseDefinitionRevisionId = command.baseDefinitionRevisionId;
  } else if (command.baseDefinitionRevisionId) {
    const visible = await assertRevisionVisibleInRelease(
      client,
      command.baseRelease.id,
      command.baseDefinitionRevisionId,
      command.baseDefinitionId,
    );
    if (!visible.ok) return visible;
    baseDefinitionRevisionId = command.baseDefinitionRevisionId;
  }

  const proposalId = `dprop_${randomUUID()}`;
  const revisionId = `dprev_${randomUUID()}`;
  const proposal = await insertProposal(client, {
    id: proposalId,
    organizationId: command.organizationId,
    authorPrincipalId: command.context.principalId,
    baseCatalogReleaseId: command.baseRelease.id,
    baseDefinitionRevisionId,
    currentProposalRevisionId: revisionId,
    status,
  });
  const revision = await insertProposalRevision(client, {
    id: revisionId,
    proposalId,
    payload: asJson(command.payload),
    reason: command.reason,
    evidenceRefs: asJson(command.evidenceRefs),
  });
  await testHooks?.afterStatusBeforeSuccessAudit?.();
  const snapshot = snapshotOf(proposal, revision, null);
  await writeSuccessAudit(client, command, proposalId, fingerprint, snapshot);
  await commitIdempotency(client, command, proposalId);
  return { ok: true, value: toResult(snapshot, command, fingerprint, "committed") };
};

const writeCreateDraft = (
  client: ProposalWriterClient,
  command: CreateDraftProposalCommand,
  fingerprint: string,
  live: CatalogReleasePin,
): Promise<Result<ProposalResult, ProposalFailure>> =>
  writeCreatedProposal(client, command, fingerprint, live, "draft");

const writeCreateAndSubmit = (
  client: ProposalWriterClient,
  command: SubmitProposalCommand,
  fingerprint: string,
  live: CatalogReleasePin,
): Promise<Result<ProposalResult, ProposalFailure>> =>
  writeCreatedProposal(client, command, fingerprint, live, "submitted");

const writeSubmitExisting = async (
  client: ProposalWriterClient,
  command: SubmitExistingProposalCommand,
  fingerprint: string,
  live: CatalogReleasePin,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const liveCheck = requireLivePin(command.currentRelease, live);
  if (!liveCheck.ok) return liveCheck;
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
  const storedPin = await loadReleasePin(client, proposal.base_catalog_release_id);
  if (!storedPin) {
    return fail({ kind: "invalid-command", reason: "baseRelease" });
  }
  if (!pinsEqual(storedPin, live)) {
    return stale(storedPin, live);
  }
  if (proposal.status !== "draft") {
    return fail({
      kind: "invalid-transition",
      from: proposal.status,
      attempted: "submitted",
    });
  }
  return commitStatus(client, command, proposal, revision, fingerprint, "submitted", null);
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
  return commitStatus(client, command, proposal, revision, fingerprint, "withdrawn", null);
};

const writeAccept = async (
  client: ProposalWriterClient,
  command: AcceptProposalCommand,
  fingerprint: string,
  live: CatalogReleasePin,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const liveCheck = requireLivePin(command.currentRelease, live);
  if (!liveCheck.ok) return liveCheck;
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
  const storedPin = await loadReleasePin(client, proposal.base_catalog_release_id);
  if (!storedPin) {
    return fail({ kind: "invalid-command", reason: "baseRelease" });
  }
  if (!pinsEqual(storedPin, live)) {
    return stale(storedPin, live);
  }
  if (proposal.status !== "submitted") {
    return fail({
      kind: "invalid-transition",
      from: proposal.status,
      attempted: "accepted",
    });
  }
  const currentEtag = etagOf(proposal);
  const updated = await updateProposalStatus(
    client,
    proposal.id,
    "accepted",
    currentEtag,
    currentEtag + 1,
  );
  if (!updated) {
    return etagConflict(command, proposal);
  }
  await testHooks?.afterStatusBeforeSuccessAudit?.();
  const intentId = `cpint_${randomUUID()}`;
  const auditId = `audit_${randomUUID()}`;
  const publicationIntent: PublicationIntentResult = {
    id: PublicationIntentId(intentId),
    repositoryReference: command.repositoryReference,
    reviewerPrincipalId: command.context.principalId,
    successAuditRef: auditId,
  };
  const snapshot = snapshotOf(updated, revision, publicationIntent);
  await writeSuccessAudit(client, command, proposal.id, fingerprint, snapshot, auditId);
  const intent = await insertPublicationIntent(client, {
    id: intentId,
    proposalId: proposal.id,
    proposalRevisionId: revision.id,
    baseCatalogReleaseId: proposal.base_catalog_release_id,
    repositoryReference: command.repositoryReference,
    reviewerPrincipalId: command.context.principalId,
    successAuditRef: auditId,
  });
  await commitIdempotency(client, command, proposal.id);
  return {
    ok: true,
    value: toResult(
      snapshotOf(updated, revision, intentResult(intent)),
      command,
      fingerprint,
      "committed",
    ),
  };
};

const writeReject = async (
  client: ProposalWriterClient,
  command: RejectProposalCommand,
  fingerprint: string,
  live: CatalogReleasePin,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const liveCheck = requireLivePin(command.currentRelease, live);
  if (!liveCheck.ok) return liveCheck;
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
  const storedPin = await loadReleasePin(client, proposal.base_catalog_release_id);
  if (!storedPin) {
    return fail({ kind: "invalid-command", reason: "baseRelease" });
  }
  if (!pinsEqual(storedPin, live)) {
    return stale(storedPin, live);
  }
  if (proposal.status !== "submitted") {
    return fail({
      kind: "invalid-transition",
      from: proposal.status,
      attempted: "rejected",
    });
  }
  return commitStatus(client, command, proposal, revision, fingerprint, "rejected", null);
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

  if (command.kind === "withdraw") {
    return writeWithdraw(client, command, fingerprint);
  }

  const live = await lockAndLoadCurrentRelease(client);
  if (!live.ok) return live;

  switch (command.kind) {
    case "create-draft":
      return writeCreateDraft(client, command, fingerprint, live.value);
    case "submit":
      return writeCreateAndSubmit(client, command, fingerprint, live.value);
    case "submit-existing":
      return writeSubmitExisting(client, command, fingerprint, live.value);
    case "accept":
      return writeAccept(client, command, fingerprint, live.value);
    case "reject":
      return writeReject(client, command, fingerprint, live.value);
  }
};
