import { createHash } from "node:crypto";

import {
  serializeContract,
  type CatalogReleasePin,
  type CatalogSubjectId,
  type CatalogSubjectKind,
  type ContractJsonValue,
  type PlacementIntent,
  type ReviewItemEtag,
  type ReviewItemId,
  type ReviewReason,
  type ReviewResolutionType,
  type SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import type { GovernanceFailure } from "./failures";
import type { Result } from "./result";

export const reviewResolutionCommandFamily = "review-resolution";

export type TrustedInvocationContext =
  | {
      readonly actorKind: "org-admin";
      readonly principalId: string;
      readonly organizationId: string;
    }
  | {
      readonly actorKind: "org-member";
      readonly principalId: string;
      readonly organizationId: string;
    }
  | {
      readonly actorKind: "platform-admin";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "trusted-system";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "agent";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "anonymous";
    };

export type RegistrationProof = {
  readonly [key: string]: ContractJsonValue;
};

type ResolveReviewItemCommandBase = {
  readonly organizationId: string;
  readonly reviewItemId: ReviewItemId;
  readonly expectedRelease: CatalogReleasePin;
  readonly etag: ReviewItemEtag;
  readonly idempotencyKey: string;
  readonly context: TrustedInvocationContext;
  readonly reason: ReviewReason;
};

export type RegisterSubjectResolutionCommand = ResolveReviewItemCommandBase & {
  readonly resolution: "register-subject";
  readonly subjectId: CatalogSubjectId;
  readonly subjectKind: CatalogSubjectKind;
  readonly placement: PlacementIntent;
  readonly destinationModuleId: string;
  readonly proof?: RegistrationProof;
};

export type RestoreRegistrationResolutionCommand = ResolveReviewItemCommandBase & {
  readonly resolution: "restore-registration";
  readonly registrationId: SubjectRegistrationId;
};

export type MarkOutOfScopeResolutionCommand = ResolveReviewItemCommandBase & {
  readonly resolution: "mark-out-of-scope";
  readonly outOfScopeReason: string;
};

export type OpenDefinitionProposalResolutionCommand = ResolveReviewItemCommandBase & {
  readonly resolution: "open-definition-proposal";
  readonly proposal: {
    readonly reason: string;
    readonly payload?: { readonly [key: string]: ContractJsonValue };
  };
};

export type ResolveReviewItemCommand =
  | RegisterSubjectResolutionCommand
  | RestoreRegistrationResolutionCommand
  | MarkOutOfScopeResolutionCommand
  | OpenDefinitionProposalResolutionCommand;

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const invalid = (reason: string): Result<never, GovernanceFailure> => ({
  ok: false,
  error: { kind: "invalid-command", reason },
});

const permissionDenied = (
  actorKind: TrustedInvocationContext["actorKind"],
): Result<never, GovernanceFailure> => ({
  ok: false,
  error: { kind: "permission-denied", actorKind },
});

const reviewReasons = new Set<ReviewReason>([
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed",
]);

const reviewResolutions = new Set<ReviewResolutionType>([
  "register-subject",
  "restore-registration",
  "mark-out-of-scope",
  "open-definition-proposal",
]);

const hasForbiddenRegistrationPayload = (command: ResolveReviewItemCommand): boolean =>
  command.resolution !== "register-subject" &&
  ("subjectId" in command ||
    "subjectKind" in command ||
    "placement" in command ||
    "destinationModuleId" in command ||
    "proof" in command);

const hasForbiddenRestorePayload = (command: ResolveReviewItemCommand): boolean =>
  command.resolution !== "restore-registration" && "registrationId" in command;

const hasForbiddenOutOfScopePayload = (command: ResolveReviewItemCommand): boolean =>
  command.resolution !== "mark-out-of-scope" && "outOfScopeReason" in command;

const hasForbiddenProposalPayload = (command: ResolveReviewItemCommand): boolean =>
  command.resolution !== "open-definition-proposal" && "proposal" in command;

export const validateResolveReviewItemCommand = (
  command: ResolveReviewItemCommand,
): Result<ResolveReviewItemCommand, GovernanceFailure> => {
  if (!controlFree(command.organizationId)) return invalid("organizationId");
  if (!controlFree(command.reviewItemId)) return invalid("reviewItemId");
  if (!controlFree(command.idempotencyKey)) return invalid("idempotencyKey");
  if (!controlFree(command.etag)) return invalid("etag");
  if (!controlFree(command.expectedRelease?.id) || !controlFree(command.expectedRelease?.digest)) {
    return invalid("expectedRelease");
  }
  if (!reviewReasons.has(command.reason)) return invalid("reason");
  if (!reviewResolutions.has(command.resolution)) return invalid("resolution");

  const context = command.context;
  if (!context || !("actorKind" in context)) {
    return permissionDenied("anonymous");
  }
  if (context.actorKind !== "org-admin") {
    return permissionDenied(context.actorKind);
  }
  if (!controlFree(context.principalId) || !controlFree(context.organizationId)) {
    return permissionDenied(context.actorKind);
  }
  if (context.organizationId !== command.organizationId) {
    return permissionDenied(context.actorKind);
  }

  if (hasForbiddenRegistrationPayload(command)) {
    return invalid(`${command.resolution}-rejects-registration-payload`);
  }
  if (hasForbiddenRestorePayload(command)) {
    return invalid(`${command.resolution}-rejects-restore-payload`);
  }
  if (hasForbiddenOutOfScopePayload(command)) {
    return invalid(`${command.resolution}-rejects-out-of-scope-payload`);
  }
  if (hasForbiddenProposalPayload(command)) {
    return invalid(`${command.resolution}-rejects-proposal-payload`);
  }

  if (command.resolution === "register-subject") {
    if (!controlFree(command.subjectId)) return invalid("subjectId");
    if (command.subjectKind !== "driver" && command.subjectKind !== "node-type") {
      return invalid("subjectKind");
    }
    if (!controlFree(command.destinationModuleId)) return invalid("destinationModuleId");
    if (command.placement?.mode === "choose-parent") {
      if (!controlFree(command.placement.parentPlacementId)) {
        return invalid("parentPlacementId");
      }
      if (!controlFree(command.placement.displayName)) return invalid("displayName");
    } else if (command.placement?.mode !== "use-default") {
      return invalid("placement");
    }
    return { ok: true, value: command };
  }

  if (command.resolution === "restore-registration") {
    if (!controlFree(command.registrationId)) return invalid("registrationId");
    return { ok: true, value: command };
  }

  if (command.resolution === "mark-out-of-scope") {
    if (!controlFree(command.outOfScopeReason)) return invalid("outOfScopeReason");
    return { ok: true, value: command };
  }

  if (!controlFree(command.proposal.reason)) return invalid("proposal.reason");
  return { ok: true, value: command };
};

const placementModel = (placement: PlacementIntent): ContractJsonValue =>
  placement.mode === "use-default"
    ? { mode: "use-default" }
    : {
        mode: "choose-parent",
        parentPlacementId: placement.parentPlacementId,
        displayName: placement.displayName,
      };

const commandFingerprintModel = (command: ResolveReviewItemCommand): ContractJsonValue => {
  const release = {
    id: command.expectedRelease.id,
    digest: command.expectedRelease.digest,
  };
  const actor =
    command.context.actorKind === "anonymous"
      ? { actorKind: command.context.actorKind }
      : {
          actorKind: command.context.actorKind,
          principalId: command.context.principalId,
        };
  const base = {
    organizationId: command.organizationId,
    reviewItemId: command.reviewItemId,
    expectedRelease: release,
    etag: command.etag,
    reason: command.reason,
    context: actor,
  };
  switch (command.resolution) {
    case "register-subject":
      return {
        ...base,
        resolution: command.resolution,
        subjectId: command.subjectId,
        subjectKind: command.subjectKind,
        placement: placementModel(command.placement),
        destinationModuleId: command.destinationModuleId,
        proof: command.proof ?? {},
      };
    case "restore-registration":
      return {
        ...base,
        resolution: command.resolution,
        registrationId: command.registrationId,
      };
    case "mark-out-of-scope":
      return {
        ...base,
        resolution: command.resolution,
        outOfScopeReason: command.outOfScopeReason,
      };
    case "open-definition-proposal":
      return {
        ...base,
        resolution: command.resolution,
        proposal: {
          reason: command.proposal.reason,
          payload: command.proposal.payload ?? {},
        },
      };
  }
};

export const fingerprintResolveReviewItemCommand = (
  command: ResolveReviewItemCommand,
): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(commandFingerprintModel(command)))
    .digest("hex")}`;
