import { createHash } from "node:crypto";

import {
  serializeContract,
  type CatalogReleasePin,
  type CatalogSubjectId,
  type CatalogSubjectKind,
  type ContractJsonValue,
  type PlacementIntent,
  type SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import type { RegistrationFailure } from "./failures";
import type { Result } from "./result";

export const registrationCommandFamily = "subject-registration";

export type TrustedInvocationContext =
  | {
      readonly actorKind: "org-admin";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "trusted-system";
      readonly principalId: string;
    }
  | {
      readonly actorKind: "review-coordinator";
      readonly principalId: string;
    };

export type RegistrationProof = {
  readonly [key: string]: ContractJsonValue;
};

export type RegisterSubjectCommand = {
  readonly kind: "register";
  readonly organizationId: string;
  readonly subjectId: CatalogSubjectId;
  readonly subjectKind: CatalogSubjectKind;
  readonly expectedRelease: CatalogReleasePin;
  readonly placement: PlacementIntent;
  readonly destinationModuleId: string;
  readonly method: "explicit" | "automatic" | "review";
  readonly proof: RegistrationProof;
  readonly idempotencyKey: string;
  readonly context: TrustedInvocationContext;
};

export type RetireRegistrationCommand = {
  readonly kind: "retire";
  readonly organizationId: string;
  readonly registrationId: SubjectRegistrationId;
  readonly expectedRelease: CatalogReleasePin;
  readonly idempotencyKey: string;
  readonly context: TrustedInvocationContext;
  readonly reason: string;
};

export type RestoreRegistrationCommand = {
  readonly kind: "restore";
  readonly organizationId: string;
  readonly registrationId: SubjectRegistrationId;
  readonly expectedRelease: CatalogReleasePin;
  readonly idempotencyKey: string;
  readonly context: TrustedInvocationContext;
  readonly reason: string;
};

export type MovePlacementCommand = {
  readonly kind: "move-placement";
  readonly organizationId: string;
  readonly registrationId: SubjectRegistrationId;
  readonly expectedRelease: CatalogReleasePin;
  readonly destinationModuleId: string;
  readonly idempotencyKey: string;
  readonly context: TrustedInvocationContext;
};

export type RegistrationCommand =
  | RegisterSubjectCommand
  | RetireRegistrationCommand
  | RestoreRegistrationCommand
  | MovePlacementCommand;

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const invalid = (reason: string): Result<never, RegistrationFailure> => ({
  ok: false,
  error: { kind: "invalid-command", reason },
});

const permissionDenied = (
  actorKind: TrustedInvocationContext["actorKind"],
  method: string,
): Result<never, RegistrationFailure> => ({
  ok: false,
  error: { kind: "permission-denied", actorKind, method },
});

export const validateRegistrationCommand = (
  command: RegistrationCommand,
): Result<RegistrationCommand, RegistrationFailure> => {
  if (!controlFree(command.organizationId)) {
    return invalid("organizationId");
  }
  if (!controlFree(command.idempotencyKey)) {
    return invalid("idempotencyKey");
  }
  if (!controlFree(command.context.principalId)) {
    return invalid("principalId");
  }
  if (!controlFree(command.expectedRelease.id) || !controlFree(command.expectedRelease.digest)) {
    return invalid("expectedRelease");
  }

  if (command.kind === "register") {
    if (!controlFree(command.destinationModuleId)) {
      return invalid("destinationModuleId");
    }
    if (command.method === "automatic") {
      if (command.context.actorKind !== "trusted-system") {
        return permissionDenied(command.context.actorKind, command.method);
      }
      if (command.placement.mode !== "use-default") {
        return invalid("automatic-registration-requires-use-default");
      }
    } else if (command.method === "explicit") {
      if (command.context.actorKind !== "org-admin") {
        return permissionDenied(command.context.actorKind, command.method);
      }
    } else if (command.context.actorKind !== "review-coordinator") {
      return permissionDenied(command.context.actorKind, command.method);
    }
    return { ok: true, value: command };
  }

  if (command.context.actorKind === "trusted-system") {
    return permissionDenied(command.context.actorKind, command.kind);
  }
  if (command.kind === "move-placement") {
    if (!controlFree(command.destinationModuleId)) {
      return invalid("destinationModuleId");
    }
    if (command.context.actorKind !== "org-admin") {
      return permissionDenied(command.context.actorKind, command.kind);
    }
    return { ok: true, value: command };
  }
  if (
    command.context.actorKind !== "org-admin" &&
    command.context.actorKind !== "review-coordinator"
  ) {
    return permissionDenied(command.context.actorKind, command.kind);
  }
  if (!controlFree(command.reason)) {
    return invalid("reason");
  }
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

const commandFingerprintModel = (command: RegistrationCommand): ContractJsonValue => {
  const release = {
    id: command.expectedRelease.id,
    digest: command.expectedRelease.digest,
  };
  const actor = {
    actorKind: command.context.actorKind,
    principalId: command.context.principalId,
  };
  switch (command.kind) {
    case "register":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        subjectId: command.subjectId,
        subjectKind: command.subjectKind,
        expectedRelease: release,
        placement: placementModel(command.placement),
        destinationModuleId: command.destinationModuleId,
        method: command.method,
        proof: command.proof,
        context: actor,
      };
    case "move-placement":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        registrationId: command.registrationId,
        expectedRelease: release,
        destinationModuleId: command.destinationModuleId,
        context: actor,
      };
    case "retire":
    case "restore":
      return {
        kind: command.kind,
        organizationId: command.organizationId,
        registrationId: command.registrationId,
        expectedRelease: release,
        reason: command.reason,
        context: actor,
      };
  }
};

export const fingerprintRegistrationCommand = (command: RegistrationCommand): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(commandFingerprintModel(command)))
    .digest("hex")}`;
