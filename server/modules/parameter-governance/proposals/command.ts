import { createHash } from "node:crypto";

import {
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
  type DefinitionProposalId,
  type DefinitionRevisionId,
  type ParameterDefinitionId,
} from "../../parameter-catalog-contract/index";

import type { ProposalFailure } from "./failures";
import type { Result } from "./result";

export const proposalCommandFamily = "definition-proposal";

/** Internal create-and-submit adapter kind. Must not back submit-existing. */
export const createAndSubmitCommandKind = "submit" as const;

export const createDraftCommandKind = "create-draft" as const;
export const submitExistingCommandKind = "submit-existing" as const;

export type ProposalTrustedContext =
  | {
      readonly actorKind: "org-admin";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "platform-admin";
      readonly principalId: string;
    };

export type ProposalPayload = {
  readonly [key: string]: ContractJsonValue;
};

export type CreateDraftProposalCommand = {
  readonly kind: "create-draft";
  readonly organizationId: string;
  readonly baseRelease: CatalogReleasePin;
  readonly currentRelease: CatalogReleasePin;
  readonly claimedBaseReleaseId?: string;
  readonly baseDefinitionId?: ParameterDefinitionId | null;
  readonly baseDefinitionRevisionId?: DefinitionRevisionId | null;
  readonly payload: ProposalPayload;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly idempotencyKey: string;
  readonly context: ProposalTrustedContext;
};

export type SubmitExistingProposalCommand = {
  readonly kind: "submit-existing";
  readonly organizationId: string;
  readonly proposalId: DefinitionProposalId;
  readonly expectedEtag: number;
  readonly currentRelease: CatalogReleasePin;
  readonly idempotencyKey: string;
  readonly context: ProposalTrustedContext;
};

/**
 * Internal create-and-submit adapter for existing `kind: "submit"` callers.
 * Inserts a submitted Proposal in one transaction. It is not submit-existing
 * and must not back HTTP `/proposals/:id/submit`.
 */
export type SubmitProposalCommand = {
  readonly kind: "submit";
  readonly organizationId: string;
  readonly baseRelease: CatalogReleasePin;
  readonly currentRelease: CatalogReleasePin;
  readonly baseDefinitionRevisionId: DefinitionRevisionId;
  readonly payload: ProposalPayload;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly idempotencyKey: string;
  readonly context: ProposalTrustedContext;
};

export type WithdrawProposalCommand = {
  readonly kind: "withdraw";
  readonly organizationId: string;
  readonly proposalId: DefinitionProposalId;
  readonly expectedEtag: number;
  readonly idempotencyKey: string;
  readonly context: ProposalTrustedContext;
};

export type AcceptProposalCommand = {
  readonly kind: "accept";
  readonly organizationId: string;
  readonly proposalId: DefinitionProposalId;
  readonly expectedEtag: number;
  readonly currentRelease: CatalogReleasePin;
  readonly repositoryReference: string;
  readonly idempotencyKey: string;
  readonly context: ProposalTrustedContext;
};

export type RejectProposalCommand = {
  readonly kind: "reject";
  readonly organizationId: string;
  readonly proposalId: DefinitionProposalId;
  readonly expectedEtag: number;
  readonly currentRelease: CatalogReleasePin;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly context: ProposalTrustedContext;
};

export type ProposalCommand =
  | CreateDraftProposalCommand
  | SubmitExistingProposalCommand
  | SubmitProposalCommand
  | WithdrawProposalCommand
  | AcceptProposalCommand
  | RejectProposalCommand;

export type ProposalIdempotencyIdentity = {
  readonly family: string;
  readonly key: string;
};

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const invalid = (reason: string): Result<never, ProposalFailure> => ({
  ok: false,
  error: { kind: "invalid-command", reason },
});

const permissionDenied = (
  actorKind: ProposalTrustedContext["actorKind"],
  method: string,
): Result<never, ProposalFailure> => ({
  ok: false,
  error: { kind: "permission-denied", actorKind, method },
});

const pinsEqual = (left: CatalogReleasePin, right: CatalogReleasePin): boolean =>
  left.id === right.id && left.digest === right.digest;

const validatePin = (pin: CatalogReleasePin, field: string): Result<true, ProposalFailure> => {
  if (!controlFree(pin.id) || !controlFree(pin.digest)) {
    return invalid(field);
  }
  return { ok: true, value: true };
};

const validateEtag = (value: number): Result<true, ProposalFailure> => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return invalid("expectedEtag");
  }
  return { ok: true, value: true };
};

const validatePayloadFields = (
  command: CreateDraftProposalCommand | SubmitProposalCommand,
): Result<true, ProposalFailure> => {
  if (!controlFree(command.reason)) {
    return invalid("reason");
  }
  if (
    command.payload === null ||
    typeof command.payload !== "object" ||
    Array.isArray(command.payload)
  ) {
    return invalid("payload");
  }
  if (!Array.isArray(command.evidenceRefs) || command.evidenceRefs.some((ref) => !controlFree(ref))) {
    return invalid("evidenceRefs");
  }
  return { ok: true, value: true };
};

const validateMatchingPins = (
  command: CreateDraftProposalCommand | SubmitProposalCommand,
): Result<true, ProposalFailure> => {
  const base = validatePin(command.baseRelease, "baseRelease");
  if (!base.ok) return base;
  const current = validatePin(command.currentRelease, "currentRelease");
  if (!current.ok) return current;
  if (!pinsEqual(command.baseRelease, command.currentRelease)) {
    return {
      ok: false,
      error: {
        kind: "proposal-stale",
        capturedRelease: command.baseRelease,
        currentRelease: command.currentRelease,
      },
    };
  }
  return { ok: true, value: true };
};

export const isCreateLikeProposalCommand = (
  command: ProposalCommand,
): command is CreateDraftProposalCommand | SubmitProposalCommand =>
  command.kind === "create-draft" || command.kind === "submit";

export const proposalHasTargetId = (
  command: ProposalCommand,
): command is
  | SubmitExistingProposalCommand
  | WithdrawProposalCommand
  | AcceptProposalCommand
  | RejectProposalCommand =>
  command.kind === "submit-existing" ||
  command.kind === "withdraw" ||
  command.kind === "accept" ||
  command.kind === "reject";

export const proposalAuditTargetId = (command: ProposalCommand): string =>
  proposalHasTargetId(command) ? command.proposalId : command.organizationId;

export const proposalIdempotencyIdentity = (
  command: ProposalCommand,
): ProposalIdempotencyIdentity => {
  switch (command.kind) {
    case "submit":
      return { family: proposalCommandFamily, key: command.idempotencyKey };
    case "create-draft":
      return {
        family: `${proposalCommandFamily}:create-draft`,
        key: command.idempotencyKey,
      };
    case "submit-existing":
      return {
        family: `${proposalCommandFamily}:submit-existing`,
        key: `${command.proposalId}:${command.idempotencyKey}`,
      };
    case "withdraw":
      return {
        family: `${proposalCommandFamily}:withdraw`,
        key: `${command.proposalId}:${command.idempotencyKey}`,
      };
    case "accept":
      return {
        family: `${proposalCommandFamily}:accept`,
        key: `${command.proposalId}:${command.idempotencyKey}`,
      };
    case "reject":
      return {
        family: `${proposalCommandFamily}:reject`,
        key: `${command.proposalId}:${command.idempotencyKey}`,
      };
  }
};

export const validateProposalCommand = (
  command: ProposalCommand,
): Result<ProposalCommand, ProposalFailure> => {
  if (!controlFree(command.organizationId)) {
    return invalid("organizationId");
  }
  if (!controlFree(command.idempotencyKey)) {
    return invalid("idempotencyKey");
  }
  if (!controlFree(command.context.principalId)) {
    return invalid("principalId");
  }

  if (command.kind === "create-draft") {
    if (command.context.actorKind !== "org-admin") {
      return permissionDenied(command.context.actorKind, command.kind);
    }
    const pins = validateMatchingPins(command);
    if (!pins.ok) return pins;
    if (command.claimedBaseReleaseId !== undefined) {
      if (!controlFree(command.claimedBaseReleaseId)) {
        return invalid("claimedBaseReleaseId");
      }
      if (command.claimedBaseReleaseId !== command.baseRelease.id) {
        return {
          ok: false,
          error: {
            kind: "proposal-stale",
            capturedRelease: command.baseRelease,
            currentRelease: command.currentRelease,
          },
        };
      }
    }
    const hasDefinition = command.baseDefinitionId != null;
    const hasRevision = command.baseDefinitionRevisionId != null;
    if (hasDefinition !== hasRevision) {
      return invalid(hasDefinition ? "baseDefinitionRevisionId" : "baseDefinitionId");
    }
    if (hasDefinition && !controlFree(command.baseDefinitionId!)) {
      return invalid("baseDefinitionId");
    }
    if (hasRevision && !controlFree(command.baseDefinitionRevisionId!)) {
      return invalid("baseDefinitionRevisionId");
    }
    const payload = validatePayloadFields(command);
    if (!payload.ok) return payload;
    return { ok: true, value: command };
  }

  if (command.kind === "submit") {
    if (command.context.actorKind !== "org-admin") {
      return permissionDenied(command.context.actorKind, command.kind);
    }
    const pins = validateMatchingPins(command);
    if (!pins.ok) return pins;
    if (!controlFree(command.baseDefinitionRevisionId)) {
      return invalid("baseDefinitionRevisionId");
    }
    const payload = validatePayloadFields(command);
    if (!payload.ok) return payload;
    return { ok: true, value: command };
  }

  if (command.kind === "submit-existing") {
    if (command.context.actorKind !== "org-admin") {
      return permissionDenied(command.context.actorKind, command.kind);
    }
    if (!controlFree(command.proposalId)) {
      return invalid("proposalId");
    }
    const etag = validateEtag(command.expectedEtag);
    if (!etag.ok) return etag;
    const current = validatePin(command.currentRelease, "currentRelease");
    if (!current.ok) return current;
    return { ok: true, value: command };
  }

  if (!controlFree(command.proposalId)) {
    return invalid("proposalId");
  }
  const etag = validateEtag(command.expectedEtag);
  if (!etag.ok) return etag;

  if (command.kind === "withdraw") {
    if (command.context.actorKind !== "org-admin") {
      return permissionDenied(command.context.actorKind, command.kind);
    }
    return { ok: true, value: command };
  }

  if (command.context.actorKind !== "platform-admin") {
    return permissionDenied(command.context.actorKind, command.kind);
  }
  const current = validatePin(command.currentRelease, "currentRelease");
  if (!current.ok) return current;
  if (command.kind === "accept") {
    if (!controlFree(command.repositoryReference)) {
      return invalid("repositoryReference");
    }
    return { ok: true, value: command };
  }
  if (!controlFree(command.reason)) {
    return invalid("reason");
  }
  return { ok: true, value: command };
};

const pinModel = (pin: CatalogReleasePin): ContractJsonValue => ({
  id: pin.id,
  digest: pin.digest,
});

const actorModel = (context: ProposalTrustedContext): ContractJsonValue => ({
  actorKind: context.actorKind,
  principalId: context.principalId,
});

const commandFingerprintModel = (command: ProposalCommand): ContractJsonValue => {
  switch (command.kind) {
    case "create-draft":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        baseRelease: pinModel(command.baseRelease),
        currentRelease: pinModel(command.currentRelease),
        claimedBaseReleaseId: command.claimedBaseReleaseId ?? null,
        baseDefinitionId: command.baseDefinitionId ?? null,
        baseDefinitionRevisionId: command.baseDefinitionRevisionId ?? null,
        payload: command.payload,
        reason: command.reason,
        evidenceRefs: [...command.evidenceRefs],
        context: actorModel(command.context),
      };
    case "submit":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        baseRelease: pinModel(command.baseRelease),
        currentRelease: pinModel(command.currentRelease),
        baseDefinitionRevisionId: command.baseDefinitionRevisionId,
        payload: command.payload,
        reason: command.reason,
        evidenceRefs: [...command.evidenceRefs],
        context: actorModel(command.context),
      };
    case "submit-existing":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        proposalId: command.proposalId,
        expectedEtag: command.expectedEtag,
        currentRelease: pinModel(command.currentRelease),
        context: actorModel(command.context),
      };
    case "withdraw":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        proposalId: command.proposalId,
        expectedEtag: command.expectedEtag,
        context: actorModel(command.context),
      };
    case "accept":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        proposalId: command.proposalId,
        expectedEtag: command.expectedEtag,
        currentRelease: pinModel(command.currentRelease),
        repositoryReference: command.repositoryReference,
        context: actorModel(command.context),
      };
    case "reject":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        proposalId: command.proposalId,
        expectedEtag: command.expectedEtag,
        currentRelease: pinModel(command.currentRelease),
        reason: command.reason,
        context: actorModel(command.context),
      };
  }
};

export const fingerprintProposalCommand = (command: ProposalCommand): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(commandFingerprintModel(command)))
    .digest("hex")}`;

type AssertNever<T extends never> = T;
export type SubmitExistingIsNotCreateAndSubmit = AssertNever<
  Extract<keyof SubmitExistingProposalCommand, "baseDefinitionRevisionId" | "payload">
>;
export type CreateDraftIsNotSubmitExisting = AssertNever<
  Extract<keyof CreateDraftProposalCommand, "proposalId" | "expectedEtag">
>;
