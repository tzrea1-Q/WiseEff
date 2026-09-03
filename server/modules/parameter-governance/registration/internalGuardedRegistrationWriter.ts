import { randomUUID } from "node:crypto";

import {
  CatalogSubjectId,
  SubjectPlacementId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import {
  fingerprintRegistrationCommand,
  validateRegistrationCommand,
  type MovePlacementCommand,
  type RegisterSubjectCommand,
  type RegistrationCommand,
  type RestoreRegistrationCommand,
  type RetireRegistrationCommand,
} from "./command";
import type { RegistrationFailure } from "./failures";
import { mapWriterDatabaseError } from "./failures";
import {
  commitIdempotency,
  insertPlacement,
  insertRegistration,
  loadPlacementById,
  loadRegistrationById,
  loadRegistrationByOrgSubject,
  lockDestinationModule,
  reserveIdempotency,
  updatePlacementModule,
  updateRegistrationStatus,
  type DestinationModuleRow,
  type PlacementRow,
  type RegistrationRow,
  type RegistrationWriterClient,
} from "./repositories";
import { assertCatalogSubjectActive } from "./guardAdapter";
import type { RegistrationResult, Result } from "./result";

export type { RegistrationWriterClient };

const fail = (error: RegistrationFailure): Result<never, RegistrationFailure> => ({
  ok: false,
  error,
});

const expectedModuleKind = (subjectKind: RegisterSubjectCommand["subjectKind"]): string =>
  subjectKind === "driver" ? "driver-group" : "node-type";

const toResult = (
  registration: RegistrationRow,
  placement: PlacementRow,
  command: RegistrationCommand,
  fingerprint: string,
  outcome: RegistrationResult["outcome"],
): RegistrationResult => ({
  outcome,
  registrationId: SubjectRegistrationId(registration.id),
  placementId: SubjectPlacementId(placement.id),
  organizationId: registration.organization_id,
  subjectId: CatalogSubjectId(registration.subject_id),
  registrationStatus: registration.status,
  registrationMethod: registration.registration_method,
  placementOrigin: placement.origin,
  moduleId: placement.module_id,
  release: command.expectedRelease,
  idempotencyKey: command.idempotencyKey,
  fingerprint,
});

const loadStoredPair = async (
  client: RegistrationWriterClient,
  organizationId: string,
  registrationId: string,
): Promise<{ registration: RegistrationRow; placement: PlacementRow } | null> => {
  const registration = await loadRegistrationById(client, organizationId, registrationId);
  if (!registration) return null;
  const placement = await loadPlacementById(
    client,
    organizationId,
    registration.current_placement_id,
  );
  if (!placement) return null;
  return { registration, placement };
};

const requireDestination = async (
  client: RegistrationWriterClient,
  organizationId: string,
  moduleId: string,
): Promise<Result<DestinationModuleRow, RegistrationFailure>> => {
  const destination = await lockDestinationModule(client, organizationId, moduleId);
  if (!destination) {
    return fail({ kind: "invalid-placement-parent", destinationModuleId: moduleId });
  }
  return { ok: true, value: destination };
};

const writeRegister = async (
  client: RegistrationWriterClient,
  command: RegisterSubjectCommand,
  fingerprint: string,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const destination = await requireDestination(
    client,
    command.organizationId,
    command.destinationModuleId,
  );
  if (!destination.ok) return destination;
  if (destination.value.kind !== expectedModuleKind(command.subjectKind)) {
    return fail({
      kind: "invalid-placement-parent",
      destinationModuleId: command.destinationModuleId,
    });
  }
  if (command.placement.mode === "choose-parent") {
    const parent = await loadPlacementById(
      client,
      command.organizationId,
      command.placement.parentPlacementId,
    );
    if (!parent || destination.value.parent_id !== parent.module_id) {
      return fail({
        kind: "invalid-placement-parent",
        destinationModuleId: command.destinationModuleId,
      });
    }
  }

  const existing = await loadRegistrationByOrgSubject(
    client,
    command.organizationId,
    command.subjectId,
  );
  if (existing) {
    if (existing.status === "retired") {
      if (command.method === "automatic") {
        return fail({
          kind: "auto-restore-forbidden",
          registrationId: SubjectRegistrationId(existing.id),
        });
      }
      return fail({
        kind: "restore-required",
        registrationId: SubjectRegistrationId(existing.id),
      });
    }
    const existingPlacement = await loadPlacementById(
      client,
      command.organizationId,
      existing.current_placement_id,
    );
    if (!existingPlacement) {
      return fail({ kind: "registration-not-found", registrationId: existing.id });
    }
    if (existingPlacement.module_id !== command.destinationModuleId) {
      return fail({
        kind: "placement-conflict",
        registrationId: existing.id,
        placementId: existingPlacement.id,
      });
    }
    await commitIdempotency(client, command, existing.id);
    return {
      ok: true,
      value: toResult(existing, existingPlacement, command, fingerprint, "replayed"),
    };
  }

  const registrationId = `sreg_${randomUUID()}`;
  const placementId = `spla_${randomUUID()}`;
  const origin = command.method === "automatic" ? "auto" : "curated";
  const registration = await insertRegistration(client, {
    id: registrationId,
    organizationId: command.organizationId,
    subjectId: command.subjectId,
    method: command.method,
    proof: command.proof,
    placementId,
  });
  const placement = await insertPlacement(client, {
    id: placementId,
    registrationId,
    organizationId: command.organizationId,
    moduleId: command.destinationModuleId,
    origin,
  });
  await commitIdempotency(client, command, registration.id);
  return {
    ok: true,
    value: toResult(registration, placement, command, fingerprint, "committed"),
  };
};

const writeRetire = async (
  client: RegistrationWriterClient,
  command: RetireRegistrationCommand,
  fingerprint: string,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const pair = await loadStoredPair(client, command.organizationId, command.registrationId);
  if (!pair) {
    return fail({ kind: "registration-not-found", registrationId: command.registrationId });
  }
  if (pair.registration.status !== "retired") {
    await updateRegistrationStatus(client, pair.registration.id, "retired");
    pair.registration.status = "retired";
  }
  await commitIdempotency(client, command, pair.registration.id);
  return {
    ok: true,
    value: toResult(pair.registration, pair.placement, command, fingerprint, "committed"),
  };
};

const writeRestore = async (
  client: RegistrationWriterClient,
  command: RestoreRegistrationCommand,
  fingerprint: string,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const pair = await loadStoredPair(client, command.organizationId, command.registrationId);
  if (!pair) {
    return fail({ kind: "registration-not-found", registrationId: command.registrationId });
  }
  if (pair.registration.status !== "active") {
    await updateRegistrationStatus(client, pair.registration.id, "active");
    pair.registration.status = "active";
  }
  await commitIdempotency(client, command, pair.registration.id);
  return {
    ok: true,
    value: toResult(pair.registration, pair.placement, command, fingerprint, "committed"),
  };
};

const writeMove = async (
  client: RegistrationWriterClient,
  command: MovePlacementCommand,
  fingerprint: string,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const pair = await loadStoredPair(client, command.organizationId, command.registrationId);
  if (!pair) {
    return fail({ kind: "registration-not-found", registrationId: command.registrationId });
  }
  const destination = await requireDestination(
    client,
    command.organizationId,
    command.destinationModuleId,
  );
  if (!destination.ok) return destination;
  const placement =
    pair.placement.module_id === command.destinationModuleId
      ? pair.placement
      : await updatePlacementModule(client, pair.placement.id, command.destinationModuleId);
  await commitIdempotency(client, command, pair.registration.id);
  return {
    ok: true,
    value: toResult(pair.registration, placement, command, fingerprint, "committed"),
  };
};

const subjectIdForGuard = async (
  client: RegistrationWriterClient,
  command: RegistrationCommand,
): Promise<Result<string, RegistrationFailure>> => {
  if (command.kind === "register") {
    return { ok: true, value: command.subjectId };
  }
  const registration = await loadRegistrationById(
    client,
    command.organizationId,
    command.registrationId,
  );
  if (!registration) {
    return fail({ kind: "registration-not-found", registrationId: command.registrationId });
  }
  return { ok: true, value: registration.subject_id };
};

export const writeGuardedRegistration = async (
  client: RegistrationWriterClient,
  command: RegistrationCommand,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const validated = validateRegistrationCommand(command);
  if (!validated.ok) return validated;
  const fingerprint = fingerprintRegistrationCommand(command);

  try {
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
      const stored = await loadStoredPair(client, command.organizationId, reserved.result_ref);
      if (!stored) {
        return fail({ kind: "registration-not-found", registrationId: reserved.result_ref });
      }
      return {
        ok: true,
        value: toResult(stored.registration, stored.placement, command, fingerprint, "replayed"),
      };
    }

    const subjectId = await subjectIdForGuard(client, command);
    if (!subjectId.ok) return subjectId;
    if (command.kind !== "retire") {
      const guarded = await assertCatalogSubjectActive(
        client,
        command.expectedRelease,
        subjectId.value,
      );
      if (!guarded.ok) return guarded;
    }

    switch (command.kind) {
      case "register":
        return writeRegister(client, command, fingerprint);
      case "retire":
        return writeRetire(client, command, fingerprint);
      case "restore":
        return writeRestore(client, command, fingerprint);
      case "move-placement":
        return writeMove(client, command, fingerprint);
    }
  } catch (error) {
    const subjectId = command.kind === "register" ? command.subjectId : command.registrationId;
    const mapped = mapWriterDatabaseError(error, command.expectedRelease, subjectId);
    if (mapped) return fail(mapped);
    throw error;
  }
};
