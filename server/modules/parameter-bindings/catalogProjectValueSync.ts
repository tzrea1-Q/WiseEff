/**
 * Consumer of Catalog Kernel + Binding/ProjectValue owners.
 * DTS ingest/workbench/import write project values under published definitions.
 * Does not publish Catalog definitions.
 */
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import { ApiError } from "../../shared/http/errors";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  NormalizedNodeTypeName,
  createCatalogKernel,
  DriverCompatible,
  PropertyKey,
  type CatalogSnapshot,
} from "../catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../catalog-kernel/install/currentPointer";
import { createPinCapturingCatalogRuntime } from "../catalog-publication/runtime";
import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  ParameterBindingId,
  ParameterDefinitionId,
  SubjectRegistrationId,
  CatalogSubjectId,
  serializeContract,
  parseCanonicalNodeName,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../parameter-catalog-contract/index";
import { stabilizeCanonicalBinding, type Binding } from "../parameter-bindings/binding";
import {
  readProjectProtectedParameters,
  writebackProtectedReference,
} from "../parameter-bindings/adapters";
import type { ProjectValuePayload } from "../parameter-bindings/values";
import type { ValueClient } from "../parameter-bindings/values/repositories";
import { parseDtsValue, renderDtsValue } from "../dts/valueAst";
import { parseJsonSource, readJsonSourceValue } from "../parameter-files/jsonSource";
import { deriveDtsSourceRef, isDtsSourceRef, sourcePathOf } from "../dts/sourceRef";
import type { DtsValue } from "../dts/types";
import { isStructuralPropertyKey } from "../parameter-topology/parameterSurface";
import { dtsValueSchema } from "../parameter-topology/schemas";
import { loadCanonicalSourceSnapshot, validatePinnedDtsSourceChange, type CanonicalSourceManifest } from "../parameter-files/canonicalSource";
import { lockExactSourceRevisionsForProof, rethrowSourceTransactionError } from "../parameter-files/sourceVersion";
import { canViewParameters } from "../parameter-kernel/policy";
import type { ObjectStore } from "../logs/objectStore";

export type CatalogBindingView = {
  id: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  definitionId: string;
  effectiveRevisionId: string;
  currentValueId: string;
  projectId: string;
  propertyKey: string;
  driverModule: string | null;
  logicalNodeId: string | null;
  instanceName: string | null;
  locator: string | null;
  typedValue: CatalogBindingValue;
  rawValue: string;
  schemaState: "valid";
  policyState: "not_applicable";
  moduleId: string;
  displayName: string | null;
  description: string | null;
  documentation: string | null;
};

export type CatalogBindingValue =
  | DtsValue
  | { readonly kind: "json"; readonly value: ContractJsonValue };

const VALUES_RELATION = ["project_parameter", "values"].join("_");

export function asValueClient(db: Queryable): ValueClient {
  return {
    query: async <Row extends pg.QueryResultRow>(text: string, values?: unknown[]) => {
      const result = await db.query<Row>(text, values);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
        command: "UNKNOWN",
        oid: 0,
        fields: [],
      } as pg.QueryResult<Row>;
    },
  };
}

const pinOf = (id: string, digest: string): CatalogReleasePin => ({
  id: CatalogReleaseId(id),
  digest: CatalogReleaseDigest(digest),
});

export function dtsValueToPayload(value: DtsValue): ProjectValuePayload {
  switch (value.kind) {
    case "boolean":
      return { kind: "boolean", value: true };
    case "empty":
      return { kind: "json", value: null };
    case "strings":
      return value.values.length === 1
        ? { kind: "string", value: value.values[0] ?? "" }
        : { kind: "string-array", value: value.values };
    case "cells": {
      const cells = value.groups.flat();
      const integers = cells.filter(
        (cell): cell is { kind: "integer"; raw: string; value: string } => cell.kind === "integer",
      );
      if (value.bits === 32 && value.groups.length === 1 && integers.length === cells.length && integers.length > 0) {
        const numbers = integers.map((cell) => Number(cell.value));
        if (numbers.every((entry) => Number.isSafeInteger(entry))) {
          return numbers.length === 1
            ? { kind: "number", value: numbers[0]! }
            : { kind: "number-array", value: numbers };
        }
      }
      return { kind: "json", value: value as unknown as ContractJsonValue };
    }
    case "bytes":
    case "mixed":
      return { kind: "json", value: value as unknown as ContractJsonValue };
  }
}

export function rawTextToPayload(propertyKey: string, rawText: string): ProjectValuePayload {
  return dtsValueToPayload(parseDtsValue(propertyKey, rawText).value);
}

export function importTextToDtsValue(propertyKey: string, text: string): DtsValue {
  const trimmed = text.trim();
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
    if (!/^-?(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) {
      throw new ApiError("VALIDATION_FAILED", "A bare DTS value must be an integer literal; use JSON for decimals.");
    }
    return parseDtsValue(propertyKey, `<${trimmed}>`).value;
  }
  return parseDtsValue(propertyKey, trimmed).value;
}

export function payloadToBindingView(
  payload: ProjectValuePayload,
  sourceFormat?: "dts" | "json",
): {
  typedValue: CatalogBindingValue;
  rawValue: string;
} {
  if (sourceFormat === "json" && payload.kind !== "json") {
    throw new ApiError("CONFLICT", "A JSON source pin contains a non-JSON project value payload.");
  }
  let typedValue: CatalogBindingValue;
  switch (payload.kind) {
    case "boolean":
      typedValue = { kind: "boolean", present: true };
      break;
    case "string":
      typedValue = { kind: "strings", values: [payload.value] };
      break;
    case "string-array":
      typedValue = { kind: "strings", values: [...payload.value] };
      break;
    case "number": {
      const raw = String(payload.value);
      typedValue = {
        kind: "cells",
        bits: 32,
        groups: [[{ kind: "integer", raw, value: raw }]],
      };
      break;
    }
    case "number-array":
      typedValue = {
        kind: "cells",
        bits: 32,
        groups: [
          payload.value.map((entry) => {
            const raw = String(entry);
            return { kind: "integer" as const, raw, value: raw };
          }),
        ],
      };
      break;
    case "json":
      if (sourceFormat === "json") {
        typedValue = { kind: "json", value: payload.value };
        return { typedValue, rawValue: serializeContract(payload.value) };
      }
      if (sourceFormat !== "dts") {
        throw new ApiError("CONFLICT", "A JSON project value requires its exact source pin format.");
      }
      {
        const parsed = dtsValueSchema.safeParse(payload.value);
        if (!parsed.success) {
          throw new ApiError("CONFLICT", "A DTS project value contains an invalid typed payload.");
        }
        typedValue = parsed.data as DtsValue;
      }
      break;
  }
  return { typedValue: typedValue as DtsValue, rawValue: renderDtsValue(typedValue as DtsValue) };
}

export async function loadPublishedCatalog(pool: pg.Pool): Promise<CatalogSnapshot | null> {
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind !== "installed") {
    return null;
  }
  const loaded = await createPinCapturingCatalogRuntime(pool, createCatalogKernel(pool)).loadCurrentCatalog(
    pinOf(pointer.current.id, pointer.current.digest),
  );
  return loaded.ok ? loaded.value : null;
}

export function publishedCatalogOwnsProperty(
  snapshot: CatalogSnapshot,
  compatibles: readonly string[],
  propertyKey: string,
): boolean {
  if (compatibles.length === 0 || propertyKey.length === 0) {
    return false;
  }
  let driverCompatibles: ReturnType<typeof DriverCompatible>[];
  let key: ReturnType<typeof PropertyKey>;
  try {
    driverCompatibles = compatibles.map((value) => DriverCompatible(value));
    key = PropertyKey(propertyKey);
  } catch {
    return false;
  }
  const subject = snapshot.resolveSubject({
    driverCompatibles,
    nodeTypeFallback: { kind: "absent" },
  });
  if (subject.status !== "matched") {
    return false;
  }
  const definition = snapshot.getDefinition({
    subjectId: subject.subject.id,
    propertyKey: key,
  });
  return definition.status === "found";
}

/**
 * Resolve the canonical subject for one observed source property.
 *
 * A declared `compatible` wins: driver identity is what the source states. The
 * node-name fallback is consulted only when the source declares no compatible,
 * because the published Catalog carries node-type subjects that have no driver
 * selector at all (33 of the 113 vendor definitions). Passing `absent`
 * unconditionally made every one of those unreachable.
 */
export function resolveObservedSubject(
  snapshot: CatalogSnapshot,
  input: { readonly compatibles: readonly string[]; readonly nodeName: string | null },
): { readonly subjectId: string; readonly subjectKind: string } | null {
  let driverCompatibles: ReturnType<typeof DriverCompatible>[];
  if (input.compatibles.length > 0) {
    try {
      driverCompatibles = input.compatibles.map((value) => DriverCompatible(value));
    } catch {
      return null;
    }
  } else {
    driverCompatibles = [];
  }
  let nodeTypeFallback:
    | { readonly kind: "present"; readonly name: ReturnType<typeof NormalizedNodeTypeName> }
    | { readonly kind: "absent" } = { kind: "absent" };
  if (driverCompatibles.length === 0 && input.nodeName) {
    // The contract parser owns the grammar; the kernel brander owns the brand the
    // snapshot selector expects. Both are needed, and the contract's own branded
    // alias is not assignable to the kernel's.
    const parsed = parseCanonicalNodeName(input.nodeName);
    if (parsed.ok) nodeTypeFallback = { kind: "present", name: NormalizedNodeTypeName(parsed.value) };
  }
  const subject = snapshot.resolveSubject({ driverCompatibles, nodeTypeFallback });
  return subject.status === "matched"
    ? { subjectId: subject.subject.id, subjectKind: subject.subject.kind }
    : null;
}

type ObservedProperty = {
  logicalNodeId: string;
  locator: string;
  /** DTS node name, used only as the node-type fallback when no compatible exists. */
  name: string | null;
  compatible: string | null;
  propertyKey: string;
  rawText: string;
  fileName: string | null;
  fileId: string;
  fileVersionId: string;
  propertyOccurrenceId: string;
  nodeOccurrenceId: string;
  organizationId: string;
  projectId: string;
  configSetId: string;
  currentFileVersionId: string | null;
};

export const parseCompatibles = (raw: string | null): string[] => {
  if (!raw) return [];
  const quoted = [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  if (quoted.length > 0) return quoted;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

type WriteSession = pg.Pool | ValueClient;

const isPoolSession = (session: WriteSession): session is pg.Pool =>
  typeof (session as pg.Pool).connect === "function" && !("release" in session);

const asWriteClient = (session: WriteSession): ValueClient => {
  if (isPoolSession(session)) {
    return {
      query: async <Row extends pg.QueryResultRow>(text: string, values?: unknown[]) =>
        session.query<Row>(text, values),
    };
  }
  return session;
};

export async function listObservedProperties(
  session: ValueClient,
  configRevisionId: string,
): Promise<ObservedProperty[]> {
  const result = await session.query<ObservedProperty>(
    `
    select
      lnr.logical_node_id as "logicalNodeId",
      lnr.node_locator as locator,
      lnr.name,
      lnr.compatible,
      oe.property_name as "propertyKey",
      po.raw_text as "rawText",
      member.source_name as "fileName",
      file.id as "fileId", po.file_version_id as "fileVersionId",
      po.id as "propertyOccurrenceId", po.node_occurrence_id as "nodeOccurrenceId",
      file.organization_id as "organizationId", file.project_id as "projectId",
      file.config_set_id as "configSetId", file.current_version_id as "currentFileVersionId"
    from dts_occurrence_effects oe
    inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
    inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
    inner join project_parameter_file_versions version on version.id = po.file_version_id
    inner join project_parameter_files file on file.id = version.file_id
    inner join dts_config_revision_members member
      on member.config_revision_id = oe.config_revision_id
     and member.file_id = file.id and member.file_version_id = version.id
    where oe.config_revision_id = $1
      and oe.effect_kind in ('set', 'override')
      and not exists (
        select 1 from dts_occurrence_effects later
        where later.config_revision_id=oe.config_revision_id
          and later.logical_node_revision_id=oe.logical_node_revision_id
          and later.property_name=oe.property_name and later.source_order>oe.source_order
      )
    `,
    [configRevisionId],
  );
  return result.rows;
}

async function activeRegistrationId(
  session: ValueClient,
  organizationId: string,
  subjectId: string,
): Promise<string | null> {
  const result = await session.query<{ id: string }>(
    `
    select id
      from parameter_catalog.organization_subject_registrations
     where organization_id = $1
       and subject_id = $2
       and status = 'active'
     order by id
     limit 1
    `,
    [organizationId, subjectId],
  );
  return result.rows[0]?.id ?? null;
}

type CatalogProjectValueSyncInput = {
  organizationId: string;
  projectId: string;
  configSetId: string;
  configRevisionId: string;
};

/** Prepare the immutable Catalog snapshot before owning a write connection. */
export async function syncPublishedCatalogProjectValues(pool: pg.Pool,input: CatalogProjectValueSyncInput): Promise<number> {
  const snapshot = await loadPublishedCatalog(pool);
  if (!snapshot) return 0;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const count = await syncPublishedCatalogProjectValuesInTransaction(asValueClient(client),snapshot,input);
    await client.query("commit");
    return count;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Caller owns the transaction and audit; this operation never acquires another connection. */
export async function syncPublishedCatalogProjectValuesInTransaction(
  write: ValueClient,snapshot: CatalogSnapshot,input: CatalogProjectValueSyncInput,
): Promise<number> {
  try {
  const sourceMembers = await write.query<{ fileId: string; fileVersionId: string }>(
    `select file_id as "fileId",file_version_id as "fileVersionId" from dts_config_revision_members
     where config_revision_id=$1 order by id`, [input.configRevisionId]);
  if (!sourceMembers.rows.length) throw new ApiError("CONFLICT", "Source revision has no exact members.");
  await lockExactSourceRevisionsForProof(write as unknown as Queryable,sourceMembers.rows.map((member) => ({ ...input,...member })));
  const established = await write.query(`select binding.id from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    left join parameter_catalog.project_value_source_pins pin on pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
    where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3
      and (pin.id is null or pin.config_revision_id<>$4)`,
  [input.organizationId,input.projectId,input.configSetId,input.configRevisionId]);
  if (established.rows.length) throw new ApiError("CONFLICT", "Existing source values require a reviewed source change, not re-materialization.");
  const observed = await listObservedProperties(write, input.configRevisionId);
  // The config-set ref is the write the operator approved; the real `.dts`
  // source location is the file the occurrence came from.  Recording the file
  // keeps the value's provenance usable by identity correction and property-key
  // cutover, which only rewrite `.dts` sources.
  const configSetSourceRef = `config-set:${input.configSetId}`;
  const sourceRefFor = (row: ObservedProperty): string =>
    row.fileName && row.fileName.endsWith(".dts")
      ? deriveDtsSourceRef({ fileName: row.fileName, nodeLocator: row.locator })
      : configSetSourceRef;
  let written = 0;
  for (const row of observed) {
    if (isStructuralPropertyKey(row.propertyKey)) continue;
    const compatibles = parseCompatibles(row.compatible);
    let driverCompatibles: ReturnType<typeof DriverCompatible>[];
    let key: ReturnType<typeof PropertyKey>;
    try {
      driverCompatibles = compatibles.map((value) => DriverCompatible(value));
      key = PropertyKey(row.propertyKey);
    } catch {
      continue;
    }
    const subject = resolveObservedSubject(snapshot, {
      compatibles,
      nodeName: row.name,
    });
    if (!subject) continue;
    const definition = snapshot.getDefinition({
      subjectId: CatalogSubjectId(subject.subjectId),
      propertyKey: key,
    });
    if (definition.status !== "found") continue;
    const registrationId = await activeRegistrationId(
      write,
      input.organizationId,
      subject.subjectId,
    );
    if (!registrationId) continue;
    if (row.currentFileVersionId !== row.fileVersionId) {
      throw new ApiError("CONFLICT", "Source materialization cannot activate a stale file version.");
    }
    if (row.organizationId !== input.organizationId || row.projectId !== input.projectId || row.configSetId !== input.configSetId) {
      throw new ApiError("CONFLICT", "Observed source does not belong to the requested configuration set.");
    }
    await write.query(
      `insert into parameter_catalog.project_parameter_source_occurrences
         (id, organization_id, project_id, config_set_id, file_id, occurrence_kind, logical_node_id)
       values ($1,$2,$3,$4,$5,'dts',$6) on conflict do nothing`,
      [randomUUID(), input.organizationId, input.projectId, input.configSetId, row.fileId, row.logicalNodeId],
    );
    const occurrence = await write.query<{ id: string }>(
      `select id from parameter_catalog.project_parameter_source_occurrences
       where organization_id=$1 and project_id=$2 and config_set_id=$3 and file_id=$4
         and occurrence_kind='dts' and logical_node_id=$5`,
      [input.organizationId, input.projectId, input.configSetId, row.fileId, row.logicalNodeId],
    );
    if (occurrence.rows.length !== 1) throw new ApiError("CONFLICT", "Source occurrence is ambiguous.");
    const sourceOccurrenceId = occurrence.rows[0]!.id;
    const stabilized = await stabilizeCanonicalBinding(write, {
      snapshot,
      organizationId: input.organizationId,
      projectId: input.projectId,
      logicalNodeId: row.logicalNodeId,
      sourceOccurrenceId,
      registrationId: SubjectRegistrationId(registrationId),
      definitionId: definition.definition.id,
      effectiveRevisionId: definition.definition.selectedRevision.id,
      expectedEffectiveRevisionId: null,
    });
    if (!stabilized.ok) {
      throw new ApiError("CONFLICT", "Published definition could not be bound for this project.", {
        reason: stabilized.error.kind,
        propertyKey: row.propertyKey,
        logicalNodeId: row.logicalNodeId,
      });
    }
    const payload = rawTextToPayload(row.propertyKey, row.rawText);
    const writtenBack = await writebackProtectedReference(write, {
      snapshot,
      binding: stabilized.value.binding,
      definitionRevisionId: definition.definition.selectedRevision.id,
      source: { sourceRef: sourceRefFor(row), configRevisionId: input.configRevisionId },
      payload,
      expectedTip: stabilized.value.binding.currentValueId,
    });
    if (!writtenBack.ok) {
      throw new ApiError("CONFLICT", "Published definition value could not be saved.", {
        reason: writtenBack.error.reason,
        propertyKey: row.propertyKey,
        logicalNodeId: row.logicalNodeId,
      });
    }
    const locator = {
      kind: "dts-property", propertyOccurrenceId: row.propertyOccurrenceId,
      nodeOccurrenceId: row.nodeOccurrenceId, fileVersionId: row.fileVersionId,
      propertyName: row.propertyKey,
    };
    await write.query(
      `insert into parameter_catalog.project_value_source_pins
        (id, project_value_id, binding_id, definition_id, organization_id, project_id,
         source_occurrence_id, config_revision_id, file_id, file_version_id,
         format, property_occurrence_id, locator, locator_digest)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,$13)
       on conflict (project_value_id) do nothing`,
      [randomUUID(), writtenBack.value.value.id, stabilized.value.binding.id,
        definition.definition.id, input.organizationId, input.projectId, sourceOccurrenceId,
        input.configRevisionId, row.fileId, row.fileVersionId, row.propertyOccurrenceId,
        JSON.stringify(locator), `sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`],
    );
    written += 1;
  }
  return written;
  } catch (error) { rethrowSourceTransactionError(error); }
}

type CatalogBindingRow = {
  id: string;
  organization_id: string;
  catalog_release_id: string;
  project_id: string;
  logical_node_id: string;
  registration_id: string;
  subject_id: string;
  definition_id: string;
  effective_revision_id: string;
  current_value_id: string;
};

export async function findCatalogBindingRow(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string },
): Promise<CatalogBindingRow | null> {
  const result = await db.query<CatalogBindingRow>(
    `
    select id, organization_id, catalog_release_id, project_id, logical_node_id,
           registration_id, subject_id, definition_id, effective_revision_id, current_value_id
      from parameter_catalog.current_project_parameter_bindings
     where organization_id = $1
       and project_id = $2
       and id = $3
     limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId],
  );
  return result.rows[0] ?? null;
}

const toBinding = (row: CatalogBindingRow, snapshot: CatalogSnapshot): Binding => ({
  id: ParameterBindingId(row.id),
  organizationId: row.organization_id,
  projectId: row.project_id,
  logicalNodeId: row.logical_node_id,
  registrationId: SubjectRegistrationId(row.registration_id),
  subjectId: row.subject_id as Binding["subjectId"],
  definitionId: ParameterDefinitionId(row.definition_id),
  effectiveRevisionId: row.effective_revision_id as Binding["effectiveRevisionId"],
  catalogRelease: snapshot.release,
  currentValueId: row.current_value_id as Binding["currentValueId"],
});

export async function saveCanonicalProjectValue(
  pool: pg.Pool,
  input: {
    organizationId: string;
    projectId: string;
    bindingId: string;
    configRevisionId: string;
    targetValue: DtsValue;
  },
  session: pg.Pool | ValueClient = pool,
): Promise<{
  bindingId: string;
  definitionId: string;
  currentValueId: string;
  propertyKey: string;
  rawText: string;
}> {
  const row = await findCatalogBindingRow(
    {
      query: async <Row>(text: string, values?: unknown[]) => {
        const result = await pool.query(text, values);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      },
    },
    input,
  );
  if (!row) {
    throw new ApiError("NOT_FOUND", "Project parameter binding was not found for this project.", {
      projectId: input.projectId,
      bindingId: input.bindingId,
    });
  }
  const kernel = createCatalogKernel(pool);
  const pin = await kernel.resolveCatalogReleasePin(CatalogReleaseId(row.catalog_release_id));
  if (!pin.ok) {
    throw new ApiError("CONFLICT", "Configured Catalog release is unavailable.", {
      reason: pin.error.kind,
    });
  }
  const loaded = await kernel.loadPinnedCatalog(pin.value);
  if (!loaded.ok) {
    throw new ApiError("CONFLICT", "Configured Catalog snapshot is unavailable.", {
      reason: loaded.error.kind,
    });
  }
  const snapshot = loaded.value;
  const binding = toBinding(row, snapshot);
  const definition = snapshot.getDefinitionById(binding.definitionId);
  if (definition.status !== "found" && definition.status !== "retired") {
    throw new ApiError("CONFLICT", "Configured Definition is unavailable.", {
      reason: definition.status,
    });
  }
  const current = await pool.query<{ source_ref: string }>(
    `
    select source_ref
      from parameter_catalog.${VALUES_RELATION}
     where id = $1
     limit 1
    `,
    [row.current_value_id],
  );
  const sourceRef = current.rows[0]?.source_ref;
  if (!sourceRef || sourceRef === "canonical-binding-identity") {
    throw new ApiError("CONFLICT", "Project value is missing an actual config-set source.", {
      bindingId: input.bindingId,
    });
  }
  const write = asWriteClient(session);
  const source = await resolveConfigRevisionForSource(write, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceRef,
    configRevisionId: input.configRevisionId,
  });
  const payload = dtsValueToPayload(input.targetValue);
  const written = await writebackProtectedReference(session, {
    snapshot,
    binding,
    definitionRevisionId: binding.effectiveRevisionId,
    source: { sourceRef, configRevisionId: source.configRevisionId },
    payload,
    expectedTip: binding.currentValueId,
  });
  if (!written.ok) {
    const status =
      written.error.reason === "missing-binding" ? "NOT_FOUND" : "CONFLICT";
    throw new ApiError(status, "Published definition value could not be saved.", {
      reason: written.error.reason,
      bindingId: input.bindingId,
    });
  }
  return {
    bindingId: written.value.pin.bindingId,
    definitionId: written.value.pin.definitionId,
    currentValueId: written.value.currentTip,
    propertyKey: definition.definition.propertyKey,
    rawText: payloadToBindingView(payload, "dts").rawValue,
  };
}

export async function listCatalogBindingRowsForProject(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; revisionId?: string },
): Promise<CatalogBindingView[]> {
  const pool = getRootPostgresPool(db);
  if (!pool) return [];
  const protectedRows = await readProjectProtectedParameters(pool, {
    invocation: createUserInvocation(auth),
    projectId: input.projectId,
  });
  const items: CatalogBindingView[] = [];
  for (const row of protectedRows) {
    if (row.pin.source.sourceRef === "canonical-binding-identity") continue;
    if (input.revisionId && row.pin.source.configRevisionId !== input.revisionId) continue;
    const locator = await db.query<{
      node_locator: string | null;
      instance_name: string | null;
      module_id: string | null;
      module_name: string | null;
      source_format: "dts" | "json" | null;
    }>(
      `
      select
        coalesce(lnr.node_locator, source_pin.locator->>'pointer') as node_locator,
        case
          when lnr.unit_address is not null then lnr.name || '@' || lnr.unit_address
          else lnr.name
        end as instance_name,
        placement.module_id,
        module.name as module_name,
        source_pin.format as source_format
      from parameter_catalog.current_project_parameter_bindings b
      left join parameter_catalog.project_parameter_values value
        on value.id = b.current_value_id
       and value.binding_id = b.id
       and value.definition_id = b.definition_id
      left join parameter_catalog.project_value_source_pins source_pin
        on source_pin.project_value_id = value.id
       and source_pin.binding_id = b.id
       and source_pin.definition_id = b.definition_id
       and source_pin.organization_id = b.organization_id
       and source_pin.project_id = b.project_id
       and source_pin.source_occurrence_id = b.source_occurrence_id
       and source_pin.config_revision_id = value.config_revision_id
      left join dts_logical_node_revisions lnr
        on lnr.logical_node_id = b.logical_node_id
       and lnr.config_revision_id = source_pin.config_revision_id
      left join parameter_catalog.organization_subject_registrations registration
        on registration.id = b.registration_id
      left join parameter_catalog.subject_placements placement
        on placement.id = registration.current_placement_id
      left join public.parameter_modules module
        on module.id = placement.module_id
      where b.id = $1 and b.current_value_id = $2 and b.effective_revision_id = $3 and b.catalog_release_id = $4
      order by lnr.config_revision_id desc nulls last
      limit 1
      `,
      [row.pin.bindingId,row.pin.currentValueId,row.pin.definitionRevisionId,row.pin.catalogRelease.id],
    );
    const loc = locator.rows[0];
    if (!loc?.source_format) throw new ApiError("CONFLICT", "Canonical read requires an exact owned source pin.");
    const view = payloadToBindingView(row.pin.payload, loc?.source_format ?? undefined);
    items.push({
      id: row.pin.bindingId,
      parameterSpecId: row.pin.definitionId,
      parameterSpecVersionId: row.pin.definitionRevisionId,
      definitionId: row.pin.definitionId,
      effectiveRevisionId: row.pin.definitionRevisionId,
      currentValueId: row.pin.currentValueId,
      projectId: row.pin.projectId,
      propertyKey: row.propertyKey,
      driverModule: loc?.module_name ?? null,
      logicalNodeId: row.pin.logicalNodeId,
      instanceName: loc?.instance_name ?? null,
      locator: loc?.node_locator ?? null,
      typedValue: view.typedValue,
      rawValue: view.rawValue,
      schemaState: "valid",
      policyState: "not_applicable",
      moduleId: loc?.module_id ?? "",
      displayName: row.revision.content.displayName,
      description: row.revision.content.description.kind === "present"
        ? row.revision.content.description.value
        : null,
      documentation: row.revision.content.documentation.kind === "present"
        ? row.revision.content.documentation.value
        : null,
    });
  }
  return items;
}

export type CatalogImportCandidate = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: "Low";
  projectParameterValueId: string;
  currentValue: string;
  currentPayload?: ProjectValuePayload;
  baseCurrentValueId?: string;
  baseRevisionId?: string;
};

export function canonicalImportValueUnchanged(candidate: CatalogImportCandidate, sourceText: string): boolean {
  if (!candidate.currentPayload) return false;
  try {
    const proposed = candidate.configFormat === "JSON"
      ? { kind: "json",value: parseJsonSource(sourceText) }
      : dtsValueToPayload(importTextToDtsValue(candidate.name,sourceText));
    return serializeContract(proposed as ContractJsonValue) === serializeContract(candidate.currentPayload as ContractJsonValue);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ApiError) return false;
    throw error;
  }
}

export function matchCatalogImportRow(
  source: { id?: string; name: string },
  candidates: readonly CatalogImportCandidate[],
): CatalogImportCandidate | null {
  if (source.id) {
    const byBinding = candidates.filter((row) => row.projectParameterValueId === source.id);
    if (byBinding.length === 1) return byBinding[0]!;
    if (byBinding.length > 1) {
      throw new ApiError("CONFLICT", "Published import identity matches more than one project value.", {
        identity: source.id
      });
    }
    const byDefinition = candidates.filter((row) => row.id === source.id);
    if (byDefinition.length === 1) return byDefinition[0]!;
    if (byDefinition.length > 1) {
      throw new ApiError("CONFLICT", "Published definition is bound more than once in this project.", {
        definitionId: source.id
      });
    }
    throw new ApiError("NOT_FOUND", "Published import identity was not found in this project.", {
      identity: source.id
    });
  }
  const byName = candidates.filter((row) => row.name === source.name);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new ApiError("CONFLICT", "Published parameter name matches more than one project value.", {
      name: source.name
    });
  }
  return null;
}

export function parseConfigSetSourceRef(sourceRef: string): string | null {
  const prefix = "config-set:";
  if (!sourceRef.startsWith(prefix)) return null;
  const id = sourceRef.slice(prefix.length).trim();
  return id.length > 0 ? id : null;
}

/**
 * The config set a project value belongs to, from either source-ref shape:
 * the opaque `config-set:<id>` write, or a `.dts` file location (resolved
 * through the project file the occurrence came from).
 */
async function resolveConfigSetIdForSource(
  session: ValueClient,
  input: { organizationId: string; projectId: string; sourceRef: string },
): Promise<string | null> {
  const fromRef = parseConfigSetSourceRef(input.sourceRef);
  if (fromRef) return fromRef;
  if (!isDtsSourceRef(input.sourceRef)) return null;
  const fileName = sourcePathOf(input.sourceRef).trim();
  if (fileName.length === 0) return null;
  const found = await session.query<{ config_set_id: string | null }>(
    `
    select config_set_id
      from project_parameter_files
     where organization_id = $1
       and project_id = $2
       and file_name = $3
       and format = 'dts'
       and enabled = true
     order by updated_at desc
     limit 1
    `,
    [input.organizationId, input.projectId, fileName],
  );
  return found.rows[0]?.config_set_id ?? null;
}

export async function resolveConfigRevisionForSource(
  session: ValueClient,
  input: {
    organizationId: string;
    projectId: string;
    sourceRef: string;
    configRevisionId: string;
  },
): Promise<{ configSetId: string; configRevisionId: string }> {
  const configSetId = await resolveConfigSetIdForSource(session, input);
  if (!configSetId) {
    throw new ApiError("CONFLICT", "Project value is missing an actual config-set source.", {
      sourceRef: input.sourceRef
    });
  }
  const found = await session.query<{
    id: string;
    organization_id: string;
    project_id: string;
    config_set_id: string;
  }>(
    `
    select id, organization_id, project_id, config_set_id
      from dts_config_revisions
     where id = $1
     limit 1
    `,
    [input.configRevisionId],
  );
  const revision = found.rows[0];
  if (!revision) {
    throw new ApiError("NOT_FOUND", "Config revision was not found.", {
      configRevisionId: input.configRevisionId
    });
  }
  if (
    revision.organization_id !== input.organizationId ||
    revision.project_id !== input.projectId ||
    revision.config_set_id !== configSetId
  ) {
    throw new ApiError("CONFLICT", "Config revision does not belong to the project value source.", {
      configRevisionId: input.configRevisionId,
      sourceRef: input.sourceRef
    });
  }
  return { configSetId, configRevisionId: revision.id };
}

export async function listCatalogBindingsForImport(
  db: Queryable,
  query: { organizationId: string; projectId: string; names: string[]; definitionIds: string[] },
): Promise<CatalogImportCandidate[]> {
  const result = await db.query<{
    id: string;
    name: string;
    current_value: string | null;
    binding_id: string;
    current_value_id: string;
    config_revision_id: string;
    source_format: string;
    value_kind: ProjectValuePayload["kind"];
    value: unknown;
  }>(
    `
    select
      b.definition_id as id,
      d.property_key as name,
      b.id as binding_id,
      b.current_value_id,v.config_revision_id,pin.format as source_format,v.value_kind,v.value,
      case
        when v.value_kind = 'number' then trim(both '"' from v.value::text)
        when v.value_kind = 'string' then trim(both '"' from v.value::text)
        else coalesce(v.value::text, '')
      end as current_value
    from parameter_catalog.current_project_parameter_bindings b
    join parameter_catalog.parameter_definitions d on d.id = b.definition_id
    join parameter_catalog.${VALUES_RELATION} v on v.id = b.current_value_id
    join parameter_catalog.project_value_source_pins pin on pin.project_value_id=v.id and pin.binding_id=b.id
    where b.organization_id = $1
      and b.project_id = $2
      and v.source_ref <> 'canonical-binding-identity'
      and (
        d.property_key = any($3::text[])
        or b.definition_id = any($4::text[])
        or b.id = any($4::text[])
      )
    order by d.property_key asc, b.id asc
    `,
    [query.organizationId, query.projectId, query.names, query.definitionIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: "",
    explanation: "",
    configFormat: row.source_format.toUpperCase(),
    module: "",
    range: "",
    unit: "",
    risk: "Low",
    projectParameterValueId: row.binding_id,
    currentValue: row.current_value ?? "",
    currentPayload: { kind: row.value_kind,value: row.value } as ProjectValuePayload,
    baseCurrentValueId: row.current_value_id,
    baseRevisionId: row.config_revision_id,
  }));
}

export type CanonicalBindingChangeHistoryEntry = {
  id: string;
  bindingId: string;
  definitionId: string;
  oldDefinitionRevisionId: string | null;
  newDefinitionRevisionId: string | null;
  oldCurrentValueId: string | null;
  newCurrentValueId: string | null;
  reason: string;
  successAuditRef: string;
  catalogReleaseId: string;
  createdAt: string;
};

/**
 * Canonical binding change history (Issue #849: "history ... uses exact canonical
 * source/value revisions").
 *
 * `parameter_catalog.binding_history_events` is written by the canonical value owner
 * on every committed tip/revision change, including the reviewed apply path. Before
 * this reader it had no read surface at all. Entries expose only canonical ids,
 * revisions, the recorded reason and the success audit reference — never archived
 * legacy payloads.
 */
export async function readCanonicalBindingChangeHistory(
  pool: pg.Pool,
  input: {
    organizationId: string;
    projectId: string;
    bindingId: string;
    limit?: number;
  },
): Promise<CanonicalBindingChangeHistoryEntry[] | null> {
  const binding = await pool.query<{ id: string; definition_id: string }>(
    `
    select id, definition_id
      from parameter_catalog.project_parameter_bindings
     where organization_id = $1
       and project_id = $2
       and id = $3
     limit 1
    `,
    [input.organizationId, input.projectId, input.bindingId],
  );
  const row = binding.rows[0];
  if (!row) return null;

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const events = await pool.query<{
    id: string;
    binding_id: string;
    definition_id: string;
    old_effective_revision_id: string | null;
    new_effective_revision_id: string | null;
    old_current_value_id: string | null;
    new_current_value_id: string | null;
    reason: string;
    success_audit_ref: string;
    catalog_release_id: string;
    created_at: string;
  }>(
    `
    select event.id,
           event.binding_id,
           b.definition_id,
           event.old_effective_revision_id,
           event.new_effective_revision_id,
           event.old_current_value_id,
           event.new_current_value_id,
           event.reason,
           event.success_audit_ref,
           event.catalog_release_id,
           event.created_at
      from parameter_catalog.binding_history_events event
      join parameter_catalog.project_parameter_bindings b on b.id = event.binding_id
     where event.binding_id = $1
     order by event.created_at desc, event.id desc
     limit $2
    `,
    [input.bindingId, limit],
  );
  return events.rows.map((event) => ({
    id: event.id,
    bindingId: event.binding_id,
    definitionId: event.definition_id,
    oldDefinitionRevisionId: event.old_effective_revision_id,
    newDefinitionRevisionId: event.new_effective_revision_id,
    oldCurrentValueId: event.old_current_value_id,
    newCurrentValueId: event.new_current_value_id,
    reason: event.reason,
    successAuditRef: event.success_audit_ref,
    catalogReleaseId: event.catalog_release_id,
    createdAt: event.created_at,
  }));
}

export type CanonicalBindingExportFile = {
  name: string;
  format: "dts" | "json";
  versionNumber: number;
  content: string;
};

export type CanonicalBindingExport = {
  bindingId: string;
  projectId: string;
  definitionId: string;
  definitionRevisionId: string;
  catalogReleaseId: string;
  configRevisionId: string;
  currentValueId: string;
  configSetId: string;
  sourceRef: string;
  files: CanonicalBindingExportFile[];
  manifest: CanonicalSourceManifest;
};

/**
 * Canonical export (Issue #849: "history, compare, baseline and export operations
 * use exact canonical source/value revisions").
 *
 * Returns the exact stored project-source bytes for the binding's pinned config
 * revision together with the canonical identity pins, so a reimport can be checked
 * against the same value/revision rather than against whatever is current later.
 * Archived legacy payloads are never returned.
 */
export async function exportCanonicalBindingSource(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; bindingId: string; projectValueId?: string },
): Promise<CanonicalBindingExport | null> {
  if (!auth.user.isActive || !canViewParameters(auth)) throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  const binding = await findCatalogBindingRow(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId,
  });
  if (!binding) return null;

  const valueId = input.projectValueId ?? binding.current_value_id;
  const current = await db.query<{ source_ref: string; config_revision_id: string; definition_id: string; definition_revision_id: string; release_ids: string[] }>(
    `
    select value.source_ref,value.config_revision_id,value.definition_id,value.definition_revision_id,
      array(select distinct history.catalog_release_id from parameter_catalog.binding_history_events history
        where history.binding_id=value.binding_id and history.new_current_value_id=value.id) as release_ids
      from parameter_catalog.project_parameter_values value
     where value.id=$1 and value.binding_id=$2
    `,
    [valueId,binding.id],
  );
  const value = current.rows[0];
  if (!value) throw new ApiError("NOT_FOUND", "Selected project value was not found for this Binding.");
  if (value.release_ids.length !== 1) throw new ApiError("CONFLICT", "Selected value has no unambiguous historical Catalog release.");
  const snapshot = await loadCanonicalSourceSnapshot(db, objectStore, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: binding.id,
    projectValueId: valueId,
  });

  return {
    bindingId: binding.id,
    projectId: binding.project_id,
    definitionId: value.definition_id,
    definitionRevisionId: value.definition_revision_id,
    catalogReleaseId: value.release_ids[0]!,
    configRevisionId: value.config_revision_id,
    currentValueId: valueId,
    configSetId: snapshot.manifest.configSetId,
    sourceRef: value.source_ref,
    files: snapshot.files,
    manifest: snapshot.manifest,
  };
}

/** An exported package is evidence only after comparison with its exact owned history. No current state is changed. */
export async function verifyCanonicalSourceReimport(
  db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; bindingId: string; source: { currentValueId: string } },
): Promise<CanonicalBindingExport> {
  const source = await exportCanonicalBindingSource(db,storage,auth,{ ...input,projectValueId: input.source.currentValueId });
  if (!source) throw new ApiError("NOT_FOUND", "Source Binding was not found.");
  if (serializeContract(source as unknown as ContractJsonValue) !== serializeContract(input.source as unknown as ContractJsonValue)) {
    throw new ApiError("CONFLICT", "Reimport package differs from its persisted owned source. Changed files require explicit source mapping or a reviewed edit.");
  }
  const manifest = source.manifest;
  const file = source.files[manifest.members.findIndex((member) => member.fileId === manifest.fileId)]!;
  let payload: ProjectValuePayload;
  if (manifest.format === "json") {
    if (typeof manifest.locator.pointer !== "string" || manifest.rootPointer === null) throw new ApiError("CONFLICT", "JSON source has no exact locator.");
    payload = { kind: "json",value: readJsonSourceValue(file.content,manifest.locator.pointer,manifest.rootPointer) as ContractJsonValue };
  } else {
    payload = dtsValueToPayload(await validatePinnedDtsSourceChange(db,manifest,file.content,file.content));
  }
  const value = (await db.query<{ value_kind: string; value: ContractJsonValue }>(
    `select value_kind,value from parameter_catalog.${VALUES_RELATION} where id=$1 and binding_id=$2`, [source.currentValueId,source.bindingId])).rows[0];
  if (!value || serializeContract(payload as ContractJsonValue) !== serializeContract({ kind: value.value_kind,value: value.value })) {
    throw new ApiError("CONFLICT", "Reimported source value disagrees with its immutable project value.");
  }
  return source;
}
