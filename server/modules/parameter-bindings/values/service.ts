import pg from "pg";
import type { Queryable } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";

import {
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
} from "../../parameter-catalog-contract/index";
import type { Binding } from "../binding";

import {
  IDENTITY_PLACEHOLDER_SOURCE,
  casCurrentTip,
  deriveHistoryEventId,
  deriveProjectValueId,
  deriveSuccessAuditId,
  digestProjectValuePayload,
  insertBindingHistoryEvent,
  insertProjectValue,
  insertSuccessAudit,
  loadBindingById,
  loadBindingReplacementState,
  loadHistoryByRevision,
  loadOwnedSourceRefs,
  loadProjectValueById,
  requiresCanonicalSourceImport as queryCanonicalSourceImport,
  discoverCurrentSourceRevisionPins as queryCurrentSourceRevisionPins,
  loadSourceBindingCohort as querySourceBindingCohort,
  loadOwnedProjectValueSourcePin as queryOwnedProjectValueSourcePin,
  isCurrentGovernedSourceValue as queryCurrentGovernedSourceValue,
  loadSourceValueReplay as querySourceValueReplay,
  type BindingTipRow,
  type ProjectValueRow,
  type ValueClient,
} from "./repositories";
import type {
  AppendProjectValueCommand,
  MutateExistingProjectValueCommand,
  ProjectValue,
  ProjectValueConflict,
  ProjectValueHistoryQuery,
  ProjectValueKind,
  ProjectValuePayload,
  ProjectValueWriteResult,
  Result,
} from "./types";

export type ProjectValueService = {
  append(
    command: AppendProjectValueCommand,
  ): Promise<Result<ProjectValueWriteResult, ProjectValueConflict>>;
  readHistory(
    query: ProjectValueHistoryQuery,
  ): Promise<Result<readonly ProjectValue[], ProjectValueConflict>>;
  mutateExisting(
    command: MutateExistingProjectValueCommand,
  ): Promise<Result<never, ProjectValueConflict>>;
};

const fail = (error: ProjectValueConflict): Result<never, ProjectValueConflict> => ({
  ok: false,
  error,
});

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

function assertSourceReadScope(input: { organizationId: string; projectId: string }) {
  if (!controlFree(input.organizationId) || !controlFree(input.projectId)) {
    throw new ApiError("CONFLICT", "Source reads require exact organization and project identities.");
  }
}

export async function requiresCanonicalSourceImport(tx: Queryable, input: { organizationId: string; projectId: string; bindingIds: string[] }) {
  assertSourceReadScope(input);
  if (!input.bindingIds.every(controlFree)) throw new ApiError("CONFLICT", "Import Binding identities are invalid.");
  return queryCanonicalSourceImport(tx,input);
}

export async function discoverCurrentSourceRevisionPins(tx: Queryable, input: { organizationId: string; projectId: string; configSetId: string }) {
  assertSourceReadScope(input);
  if (!controlFree(input.configSetId)) throw new ApiError("CONFLICT", "Source configuration identity is invalid.");
  return queryCurrentSourceRevisionPins(tx,input);
}

export async function loadSourceBindingCohort(tx: Queryable, input: { organizationId: string; projectId: string; configSetId: string }) {
  assertSourceReadScope(input);
  if (!controlFree(input.configSetId)) throw new ApiError("CONFLICT", "Source configuration identity is invalid.");
  return querySourceBindingCohort(tx,input);
}

export async function loadOwnedProjectValueSourcePin(tx: Queryable, input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string }) {
  assertSourceReadScope(input);
  if (!controlFree(input.bindingId) || !controlFree(input.projectValueId)) return null;
  return queryOwnedProjectValueSourcePin(tx,input);
}

export async function isCurrentGovernedSourceValue(tx: Queryable, input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string }) {
  assertSourceReadScope(input);
  if (!controlFree(input.bindingId) || !controlFree(input.projectValueId)) return false;
  return queryCurrentGovernedSourceValue(tx,input);
}

export async function loadSourceValueReplay(tx: Queryable, input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string; sourceOccurrenceId: string }) {
  assertSourceReadScope(input);
  if (!controlFree(input.bindingId) || !controlFree(input.projectValueId) || !controlFree(input.sourceOccurrenceId)) return null;
  return querySourceValueReplay(tx,input);
}

const VALUE_KINDS = new Set<ProjectValueKind>([
  "string",
  "number",
  "boolean",
  "string-array",
  "number-array",
  "json",
]);

const validatePayload = (
  payload: ProjectValuePayload,
): Result<ProjectValuePayload, ProjectValueConflict> => {
  switch (payload.kind) {
    case "string":
      return typeof payload.value === "string"
        ? { ok: true, value: payload }
        : fail({ kind: "invalid-command", reason: "payload" });
    case "number":
      return typeof payload.value === "number" && Number.isFinite(payload.value)
        ? { ok: true, value: payload }
        : fail({ kind: "invalid-command", reason: "payload" });
    case "boolean":
      return typeof payload.value === "boolean"
        ? { ok: true, value: payload }
        : fail({ kind: "invalid-command", reason: "payload" });
    case "string-array":
      return Array.isArray(payload.value) && payload.value.every((entry) => typeof entry === "string")
        ? { ok: true, value: payload }
        : fail({ kind: "invalid-command", reason: "payload" });
    case "number-array":
      return Array.isArray(payload.value) &&
        payload.value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
        ? { ok: true, value: payload }
        : fail({ kind: "invalid-command", reason: "payload" });
    case "json":
      return { ok: true, value: payload };
    default:
      return fail({ kind: "invalid-command", reason: "payload" });
  }
};

const validateAppendCommand = (
  command: AppendProjectValueCommand,
): Result<AppendProjectValueCommand, ProjectValueConflict> => {
  if (!controlFree(command.source.sourceRef)) {
    return fail({ kind: "invalid-command", reason: "sourceRef" });
  }
  if (!controlFree(command.source.configRevisionId)) {
    return fail({ kind: "invalid-command", reason: "configRevisionId" });
  }
  if (!controlFree(command.expectedTip)) {
    return fail({ kind: "invalid-command", reason: "expectedTip" });
  }
  if (
    command.source.sourceRef === IDENTITY_PLACEHOLDER_SOURCE ||
    command.source.configRevisionId === IDENTITY_PLACEHOLDER_SOURCE
  ) {
    return fail({ kind: "invalid-command", reason: "placeholder-source" });
  }
  const payload = validatePayload(command.payload);
  if (!payload.ok) {
    return payload;
  }
  return { ok: true, value: command };
};

const createdAtIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const decodePayload = (kind: string, value: unknown): ProjectValuePayload => {
  if (!VALUE_KINDS.has(kind as ProjectValueKind)) {
    throw new TypeError(`unsupported ProjectValue kind ${kind}`);
  }
  return { kind: kind as ProjectValueKind, value } as ProjectValuePayload;
};

const toProjectValue = (row: ProjectValueRow): ProjectValue => ({
  id: ProjectValueId(row.id),
  bindingId: ParameterBindingId(row.binding_id),
  definitionId: ParameterDefinitionId(row.definition_id),
  definitionRevisionId: DefinitionRevisionId(row.definition_revision_id),
  source: {
    sourceRef: row.source_ref,
    configRevisionId: row.config_revision_id,
  },
  valueDigest: row.value_digest,
  payload: decodePayload(row.value_kind, row.value),
  createdAt: createdAtIso(row.created_at),
});

const identityMatches = (row: BindingTipRow, binding: Binding): boolean =>
  row.organization_id === binding.organizationId &&
  row.project_id === binding.projectId &&
  row.logical_node_id === binding.logicalNodeId &&
  (!binding.sourceOccurrenceId || row.source_occurrence_id === binding.sourceOccurrenceId) &&
  row.registration_id === binding.registrationId &&
  row.subject_id === binding.subjectId &&
  row.definition_id === binding.definitionId;

const agreeStoredBinding = (
  row: BindingTipRow,
  binding: Binding,
): Result<BindingTipRow, ProjectValueConflict> => {
  if (row.organization_id !== binding.organizationId) {
    return fail({
      kind: "owner-conflict",
      bindingId: ParameterBindingId(row.id),
      existingOrganizationId: row.organization_id,
      attemptedOrganizationId: binding.organizationId,
    });
  }
  if (!identityMatches(row, binding)) {
    return fail({ kind: "agreement-conflict", reason: "binding-identity" });
  }
  return { ok: true, value: row };
};

const agreeRevision = (
  command: AppendProjectValueCommand,
  stored: BindingTipRow,
): Result<true, ProjectValueConflict> => {
  const definition = command.snapshot.getDefinitionById(command.binding.definitionId);
  if (definition.status !== "found") {
    return fail({ kind: "agreement-conflict", reason: "definition-unknown" });
  }
  const revision = command.snapshot.getDefinitionRevision({
    definitionId: command.binding.definitionId,
    revisionId: command.definitionRevisionId,
  });
  if (revision.status !== "found") {
    return fail({ kind: "agreement-conflict", reason: "revision-unavailable" });
  }
  if (command.definitionRevisionId !== stored.effective_revision_id) {
    return fail({ kind: "agreement-conflict", reason: "revision-mismatch" });
  }
  return { ok: true, value: true };
};

const isPool = (session: pg.Pool | ValueClient): session is pg.Pool =>
  typeof (session as pg.Pool).connect === "function";

const withValueUnitOfWork = async <T>(
  session: pg.Pool | ValueClient,
  work: (client: ValueClient) => Promise<Result<T, ProjectValueConflict>>,
): Promise<Result<T, ProjectValueConflict>> => {
  if (!isPool(session)) {
    await session.query("savepoint wiseeff_project_value");
    try {
      await session.query("set constraints all deferred");
      const result = await work(session);
      if (!result.ok) {
        await session.query("rollback to wiseeff_project_value");
        await session.query("release savepoint wiseeff_project_value");
        return result;
      }
      // Source-pin insertion is part of the caller's owned transaction. The
      // outer commit validates the deferred current-value/source constraint.
      await session.query("release savepoint wiseeff_project_value");
      return result;
    } catch (error) {
      await session.query("rollback to wiseeff_project_value").catch(() => undefined);
      await session.query("release savepoint wiseeff_project_value").catch(() => undefined);
      throw error;
    }
  }

  const client = await session.connect();
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

const replayed = (
  existing: ProjectValueRow,
  currentTip: string,
): Result<ProjectValueWriteResult, ProjectValueConflict> => ({
  ok: true,
  value: {
    outcome: "replayed",
    value: toProjectValue(existing),
    currentTip: ProjectValueId(currentTip),
  },
});

const writeAppend = async (
  client: ValueClient,
  command: AppendProjectValueCommand,
): Promise<Result<ProjectValueWriteResult, ProjectValueConflict>> => {
  const stored = await loadBindingById(client, command.binding.id, "update");
  if (!stored) {
    return fail({ kind: "agreement-conflict", reason: "binding-not-found" });
  }
  const agreed = agreeStoredBinding(stored, command.binding);
  if (!agreed.ok) return agreed;
  const revision = agreeRevision(command, stored);
  if (!revision.ok) return revision;
  if (command.sourceCommit) {
    const request = await client.query(`select id from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and status='pending'
        and candidate_binding_manifest @> $4::jsonb`,
    [command.sourceCommit.requestId,stored.organization_id,stored.project_id,
      JSON.stringify([{ bindingId: stored.id,oldValueId: command.expectedTip }])]);
    if (request.rows.length !== 1) return fail({ kind: "invalid-command", reason: "source-commit-cohort" });
  }

  const expected = await loadProjectValueById(client, command.expectedTip);
  if (expected && expected.binding_id !== stored.id) {
    return fail({
      kind: "source-conflict",
      reason: "cross-binding",
      bindingId: ParameterBindingId(stored.id),
      existingSourceRef: expected.source_ref,
      attemptedSourceRef: command.source.sourceRef,
    });
  }

  const ownedSources = await loadOwnedSourceRefs(client, stored.id);
  if (ownedSources.length > 0 && !ownedSources.includes(command.source.sourceRef)) {
    return fail({
      kind: "source-conflict",
      reason: "source-mismatch",
      bindingId: ParameterBindingId(stored.id),
      existingSourceRef: ownedSources[0]!,
      attemptedSourceRef: command.source.sourceRef,
    });
  }

  let valueDigest: string;
  let valueJson: string;
  try {
    valueDigest = digestProjectValuePayload(command.payload);
    valueJson = JSON.stringify(command.payload.value);
  } catch {
    return fail({ kind: "invalid-command", reason: "payload" });
  }

  if (stored.source_occurrence_id && !command.sourceCommit && expected?.source_ref !== IDENTITY_PLACEHOLDER_SOURCE) {
    // Initialization may replace its transient placeholder. Established source
    // values can only be read back here; changing them belongs to source commit.
    if (expected?.id === stored.current_value_id && expected.config_revision_id === command.source.configRevisionId
      && expected.definition_revision_id === command.definitionRevisionId
      && expected.value_kind === command.payload.kind && expected.value_digest === valueDigest) {
      const pin = await client.query(`select id from parameter_catalog.project_value_source_pins
        where project_value_id=$1 and binding_id=$2 and source_occurrence_id=$3`,
      [expected.id,stored.id,stored.source_occurrence_id]);
      if (pin.rows.length === 1) return replayed(expected,stored.current_value_id);
    }
    return fail({ kind: "invalid-command", reason: "owned-source-commit-required" });
  }

  const valueId = deriveProjectValueId({
    bindingId: stored.id,
    definitionRevisionId: command.definitionRevisionId,
    sourceRef: command.source.sourceRef,
    configRevisionId: command.source.configRevisionId,
    valueKind: command.payload.kind,
    valueDigest,
    expectedTip: command.expectedTip,
  });

  const existing = await loadProjectValueById(client, valueId);
  if (existing) {
    return replayed(existing, stored.current_value_id);
  }

  if (stored.current_value_id !== command.expectedTip) {
    return fail({
      kind: "cas-mismatch",
      bindingId: ParameterBindingId(stored.id),
      expectedTip: command.expectedTip,
      actualTip: ProjectValueId(stored.current_value_id),
    });
  }

  const inserted = await insertProjectValue(client, {
    id: valueId,
    bindingId: stored.id,
    definitionId: stored.definition_id,
    definitionRevisionId: command.definitionRevisionId,
    sourceRef: command.source.sourceRef,
    configRevisionId: command.source.configRevisionId,
    valueDigest,
    valueKind: command.payload.kind,
    valueJson,
  });
  const storedValue = inserted ?? (await loadProjectValueById(client, valueId));
  if (!storedValue) {
    return fail({ kind: "invalid-command", reason: "value-not-found" });
  }
  if (!inserted) {
    return replayed(storedValue, stored.current_value_id);
  }

  const swapped = await casCurrentTip(client, {
    bindingId: stored.id,
    expectedTip: command.expectedTip,
    nextTip: valueId,
    sourceCommitRequestId: command.sourceCommit?.requestId,
  });
  if (!swapped) {
    const raced = await loadBindingById(client, stored.id, "none");
    return fail({
      kind: "cas-mismatch",
      bindingId: ParameterBindingId(stored.id),
      expectedTip: command.expectedTip,
      actualTip: ProjectValueId(raced?.current_value_id ?? stored.current_value_id),
    });
  }

  const successAuditRef = command.sourceCommit?.auditRef ?? deriveSuccessAuditId({
    bindingId: stored.id,
    newCurrentValueId: valueId,
  });
  if (!command.sourceCommit) await insertSuccessAudit(client, {
    id: successAuditRef,
    organizationId: stored.organization_id,
    projectId: stored.project_id,
    valueId,
    bindingId: stored.id,
  });
  await insertBindingHistoryEvent(client, {
    id: deriveHistoryEventId({
      bindingId: stored.id,
      oldCurrentValueId: command.expectedTip,
      newCurrentValueId: valueId,
    }),
    bindingId: stored.id,
    effectiveRevisionId: stored.effective_revision_id,
    oldCurrentValueId: command.expectedTip,
    newCurrentValueId: valueId,
    successAuditRef,
    catalogReleaseId: stored.catalog_release_id,
    reason: command.sourceCommit?.derived ? "source-revision-propagation" : undefined,
    appliedRequestId: command.sourceCommit && !command.sourceCommit.derived ? command.sourceCommit.requestId : undefined,
  });

  return {
    ok: true,
    value: {
      outcome: "committed",
      value: toProjectValue(storedValue),
      currentTip: valueId,
    },
  };
};

export const appendProjectValue = async (
  session: pg.Pool | ValueClient,
  command: AppendProjectValueCommand,
): Promise<Result<ProjectValueWriteResult, ProjectValueConflict>> => {
  const validated = validateAppendCommand(command);
  if (!validated.ok) return validated;

  try {
    return await withValueUnitOfWork(session, (client) => writeAppend(client, command));
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === "23503") {
      return fail({ kind: "agreement-conflict", reason: "revision-unavailable" });
    }
    if (error instanceof pg.DatabaseError && error.code === "55000") {
      return fail({
        kind: "immutable-value",
        valueId: command.expectedTip,
        mutation: "update",
      });
    }
    throw error;
  }
};

export const readProjectValueHistory = async (
  pool: pg.Pool,
  query: ProjectValueHistoryQuery,
): Promise<Result<readonly ProjectValue[], ProjectValueConflict>> => {
  if (!controlFree(query.definitionRevisionId)) {
    return fail({ kind: "invalid-command", reason: "definitionRevisionId" });
  }
  const stored = await loadBindingById(pool, query.binding.id, "none");
  if (!stored) {
    return fail({ kind: "agreement-conflict", reason: "binding-not-found" });
  }
  const agreed = agreeStoredBinding(stored, query.binding);
  if (!agreed.ok) return agreed;
  const rows = await loadHistoryByRevision(pool, stored.id, query.definitionRevisionId);
  return { ok: true, value: rows.map(toProjectValue) };
};

export const mutateExistingProjectValue = async (
  pool: pg.Pool,
  command: MutateExistingProjectValueCommand,
): Promise<Result<never, ProjectValueConflict>> => {
  if (command.mutation !== "update" && command.mutation !== "delete") {
    return fail({ kind: "invalid-command", reason: "mutation" });
  }
  if (!controlFree(command.valueId)) {
    return fail({ kind: "invalid-command", reason: "valueId" });
  }
  const existing = await loadProjectValueById(pool, command.valueId);
  if (!existing) {
    return fail({ kind: "invalid-command", reason: "value-not-found" });
  }
  return fail({
    kind: "immutable-value",
    valueId: command.valueId,
    mutation: command.mutation,
  });
};

export const createProjectValueService = (pool: pg.Pool): ProjectValueService => ({
  append: (command) => appendProjectValue(pool, command),
  readHistory: (query) => readProjectValueHistory(pool, query),
  mutateExisting: (command) => mutateExistingProjectValue(pool, command),
});

/** True when a completed definition replacement superseded this Binding.  The
 * write port rejects a write naming a replaced Binding with this before it
 * appends anything. */
export const isReplacedCurrentBinding = async (
  session: pg.Pool | ValueClient,
  bindingId: string,
): Promise<boolean> => {
  if (!controlFree(bindingId)) {
    return false;
  }
  return loadBindingReplacementState(session, bindingId);
};
