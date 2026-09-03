import pg from "pg";

import {
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import {
  casEffectiveRevision,
  deriveBindingId,
  derivePlaceholderValueId,
  insertBinding,
  insertIdentityPlaceholderValue,
  loadBindingByComposite,
  loadProjectOwner,
  loadRegistrationForAgreement,
  type BindingRow,
  type BindingWriterClient,
} from "./repositories";
import type {
  Binding,
  BindingConflict,
  BindingResult,
  Result,
  StabilizeBindingCommand,
} from "./types";

export type BindingService = {
  stabilize(
    command: StabilizeBindingCommand,
  ): Promise<Result<BindingResult, BindingConflict>>;
};

export type CanonicalBindingWriteOptions = {
  readonly preservedBindingId?: ParameterBindingId;
};

const fail = (error: BindingConflict): Result<never, BindingConflict> => ({
  ok: false,
  error,
});

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const validateBindingCommand = (
  command: StabilizeBindingCommand,
): Result<StabilizeBindingCommand, BindingConflict> => {
  if (!controlFree(command.organizationId)) {
    return fail({ kind: "invalid-command", reason: "organizationId" });
  }
  if (!controlFree(command.projectId)) {
    return fail({ kind: "invalid-command", reason: "projectId" });
  }
  if (!controlFree(command.logicalNodeId)) {
    return fail({ kind: "invalid-command", reason: "logicalNodeId" });
  }
  if (!controlFree(command.registrationId)) {
    return fail({ kind: "invalid-command", reason: "registrationId" });
  }
  if (!controlFree(command.definitionId)) {
    return fail({ kind: "invalid-command", reason: "definitionId" });
  }
  if (!controlFree(command.effectiveRevisionId)) {
    return fail({ kind: "invalid-command", reason: "effectiveRevisionId" });
  }
  if (
    command.expectedEffectiveRevisionId !== null &&
    !controlFree(command.expectedEffectiveRevisionId)
  ) {
    return fail({ kind: "invalid-command", reason: "expectedEffectiveRevisionId" });
  }
  return { ok: true, value: command };
};

const toBinding = (row: BindingRow, command: StabilizeBindingCommand): Binding => ({
  id: ParameterBindingId(row.id),
  organizationId: row.organization_id,
  projectId: row.project_id,
  logicalNodeId: row.logical_node_id,
  registrationId: SubjectRegistrationId(row.registration_id),
  subjectId: CatalogSubjectId(row.subject_id),
  definitionId: ParameterDefinitionId(row.definition_id),
  effectiveRevisionId: DefinitionRevisionId(row.effective_revision_id),
  catalogRelease: command.snapshot.release,
  currentValueId: ProjectValueId(row.current_value_id),
});

const ownerMatches = (row: BindingRow, command: StabilizeBindingCommand, subjectId: string): boolean =>
  row.organization_id === command.organizationId &&
  row.project_id === command.projectId &&
  row.logical_node_id === command.logicalNodeId &&
  row.registration_id === command.registrationId &&
  row.subject_id === subjectId &&
  row.definition_id === command.definitionId;

const agreeBindingIdentity = (
  command: StabilizeBindingCommand,
  registration: { readonly organization_id: string; readonly subject_id: string; readonly status: string },
): Result<{ readonly subjectId: string }, BindingConflict> => {
  if (registration.organization_id !== command.organizationId) {
    return fail({ kind: "agreement-conflict", reason: "project-owner-mismatch" });
  }
  if (registration.status !== "active") {
    return fail({ kind: "agreement-conflict", reason: "registration-inactive" });
  }

  const definition = command.snapshot.getDefinitionById(command.definitionId);
  if (definition.status !== "found") {
    return fail({ kind: "agreement-conflict", reason: "definition-unknown" });
  }
  if (definition.definition.subjectId !== registration.subject_id) {
    return fail({ kind: "agreement-conflict", reason: "subject-mismatch" });
  }
  if (command.effectiveRevisionId !== definition.definition.selectedRevision.id) {
    return fail({ kind: "agreement-conflict", reason: "latest-head" });
  }

  const revision = command.snapshot.getDefinitionRevision({
    definitionId: command.definitionId,
    revisionId: command.effectiveRevisionId,
  });
  if (revision.status !== "found") {
    return fail({ kind: "agreement-conflict", reason: "revision-unavailable" });
  }
  return { ok: true, value: { subjectId: registration.subject_id } };
};

const withBindingUnitOfWork = async <T>(
  pool: pg.Pool,
  work: (client: BindingWriterClient) => Promise<Result<T, BindingConflict>>,
): Promise<Result<T, BindingConflict>> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    try {
      const result = await work(client);
      if (!result.ok) {
        await client.query("rollback");
        return result;
      }
      await client.query("set constraints all immediate");
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
};

const writeExisting = async (
  client: BindingWriterClient,
  command: StabilizeBindingCommand,
  existing: BindingRow,
  subjectId: string,
): Promise<Result<BindingResult, BindingConflict>> => {
  if (!ownerMatches(existing, command, subjectId)) {
    return fail({
      kind: "owner-conflict",
      bindingId: ParameterBindingId(existing.id),
      existingOrganizationId: existing.organization_id,
      attemptedOrganizationId: command.organizationId,
    });
  }

  if (command.expectedEffectiveRevisionId === null) {
    if (existing.effective_revision_id === command.effectiveRevisionId) {
      return { ok: true, value: { outcome: "replayed", binding: toBinding(existing, command) } };
    }
    return fail({
      kind: "cas-mismatch",
      bindingId: ParameterBindingId(existing.id),
      expectedEffectiveRevisionId: DefinitionRevisionId(existing.effective_revision_id),
      actualEffectiveRevisionId: DefinitionRevisionId(existing.effective_revision_id),
    });
  }

  if (existing.effective_revision_id !== command.expectedEffectiveRevisionId) {
    return fail({
      kind: "cas-mismatch",
      bindingId: ParameterBindingId(existing.id),
      expectedEffectiveRevisionId: command.expectedEffectiveRevisionId,
      actualEffectiveRevisionId: DefinitionRevisionId(existing.effective_revision_id),
    });
  }

  if (existing.effective_revision_id === command.effectiveRevisionId) {
    return { ok: true, value: { outcome: "replayed", binding: toBinding(existing, command) } };
  }

  const updated = await casEffectiveRevision(client, {
    id: existing.id,
    expectedEffectiveRevisionId: command.expectedEffectiveRevisionId,
    nextEffectiveRevisionId: command.effectiveRevisionId,
    nextCatalogReleaseId: command.snapshot.release.id,
  });
  if (!updated) {
    const raced = await loadBindingByComposite(client, command);
    return fail({
      kind: "cas-mismatch",
      bindingId: ParameterBindingId(existing.id),
      expectedEffectiveRevisionId: command.expectedEffectiveRevisionId,
      actualEffectiveRevisionId: DefinitionRevisionId(
        raced?.effective_revision_id ?? existing.effective_revision_id,
      ),
    });
  }

  return {
    ok: true,
    value: {
      outcome: "committed",
      binding: toBinding(
        {
          ...existing,
          catalog_release_id: command.snapshot.release.id,
          effective_revision_id: command.effectiveRevisionId,
        },
        command,
      ),
    },
  };
};

export const writeCanonicalBinding = async (
  pool: pg.Pool,
  command: StabilizeBindingCommand,
  options: CanonicalBindingWriteOptions = {},
): Promise<Result<BindingResult, BindingConflict>> => {
  const validated = validateBindingCommand(command);
  if (!validated.ok) return validated;

  try {
    return await withBindingUnitOfWork(pool, async (client) => {
      const projectOwned = await loadProjectOwner(
        client,
        command.projectId,
        command.organizationId,
      );
      if (!projectOwned) {
        return fail({ kind: "agreement-conflict", reason: "project-owner-mismatch" });
      }

      const registration = await loadRegistrationForAgreement(client, command.registrationId);
      if (!registration) {
        return fail({ kind: "agreement-conflict", reason: "registration-not-found" });
      }

      const agreed = agreeBindingIdentity(command, registration);
      if (!agreed.ok) return agreed;

      const existing = await loadBindingByComposite(client, command);
      if (existing) {
        return writeExisting(client, command, existing, agreed.value.subjectId);
      }

      if (command.expectedEffectiveRevisionId !== null) {
        return fail({ kind: "invalid-command", reason: "binding-not-found" });
      }

      const bindingId =
        options.preservedBindingId ??
        deriveBindingId({
          organizationId: command.organizationId,
          projectId: command.projectId,
          logicalNodeId: command.logicalNodeId,
          registrationId: command.registrationId,
          subjectId: agreed.value.subjectId,
          definitionId: command.definitionId,
        });
      const currentValueId = derivePlaceholderValueId(bindingId);

      const inserted = await insertBinding(client, {
        id: bindingId,
        organizationId: command.organizationId,
        catalogReleaseId: command.snapshot.release.id,
        projectId: command.projectId,
        logicalNodeId: command.logicalNodeId,
        registrationId: command.registrationId,
        subjectId: agreed.value.subjectId,
        definitionId: command.definitionId,
        effectiveRevisionId: command.effectiveRevisionId,
        currentValueId,
      });

      const stored =
        inserted ??
        (await loadBindingByComposite(client, command));
      if (!stored) {
        return fail({ kind: "invalid-command", reason: "binding-not-found" });
      }
      if (!inserted) {
        return writeExisting(client, command, stored, agreed.value.subjectId);
      }

      await insertIdentityPlaceholderValue(client, {
        id: currentValueId,
        bindingId: stored.id,
        definitionId: command.definitionId,
        definitionRevisionId: command.effectiveRevisionId,
      });

      return {
        ok: true,
        value: { outcome: "committed", binding: toBinding(stored, command) },
      };
    });
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === "23503") {
      return fail({ kind: "agreement-conflict", reason: "revision-unavailable" });
    }
    if (error instanceof pg.DatabaseError && error.code === "23505") {
      return fail({
        kind: "owner-conflict",
        bindingId: ParameterBindingId(command.registrationId),
        existingOrganizationId: command.organizationId,
        attemptedOrganizationId: command.organizationId,
      });
    }
    throw error;
  }
};

export const stabilizeCanonicalBinding = (
  pool: pg.Pool,
  command: StabilizeBindingCommand,
): Promise<Result<BindingResult, BindingConflict>> => writeCanonicalBinding(pool, command);

export const createBindingService = (pool: pg.Pool): BindingService => ({
  stabilize: (command) => stabilizeCanonicalBinding(pool, command),
});
