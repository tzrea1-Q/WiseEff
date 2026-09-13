/**
 * Consumer of Catalog Kernel + Binding/ProjectValue owners.
 * DTS ingest/workbench/import write project values under published definitions.
 * Does not publish Catalog definitions.
 */
import type pg from "pg";

import { ApiError } from "../../shared/http/errors";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
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
import type { DtsValue } from "../dts/types";
import { isStructuralPropertyKey } from "../parameter-topology/parameterSurface";

export type CatalogBindingView = {
  id: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  driverModule: string | null;
  logicalNodeId: string | null;
  instanceName: string | null;
  locator: string | null;
  typedValue: DtsValue;
  rawValue: string;
  schemaState: "valid";
  policyState: "not_applicable";
  moduleId: string;
  displayName: string | null;
  description: string | null;
  documentation: string | null;
};

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
      if (integers.length === cells.length && integers.length > 0) {
        const numbers = integers.map((cell) => Number(cell.value));
        if (numbers.every((entry) => Number.isFinite(entry))) {
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
    const raw = String(Number(trimmed));
    return { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw, value: raw }]] };
  }
  return parseDtsValue(propertyKey, trimmed).value;
}

export function payloadToBindingView(payload: ProjectValuePayload): {
  typedValue: DtsValue;
  rawValue: string;
} {
  let typedValue: DtsValue;
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
      if (payload.value && typeof payload.value === "object" && "kind" in payload.value) {
        typedValue = payload.value as unknown as DtsValue;
      } else {
        typedValue = { kind: "empty" };
      }
      break;
  }
  return { typedValue, rawValue: renderDtsValue(typedValue) };
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

type ObservedProperty = {
  logicalNodeId: string;
  locator: string;
  compatible: string | null;
  propertyKey: string;
  rawText: string;
};

const parseCompatibles = (raw: string | null): string[] => {
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
  typeof (session as pg.Pool).connect === "function";

const asWriteClient = (session: WriteSession): ValueClient => {
  if (isPoolSession(session)) {
    return {
      query: async <Row extends pg.QueryResultRow>(text: string, values?: unknown[]) =>
        session.query<Row>(text, values),
    };
  }
  return session;
};

async function listObservedProperties(
  session: ValueClient,
  configRevisionId: string,
): Promise<ObservedProperty[]> {
  const result = await session.query<ObservedProperty>(
    `
    select
      lnr.logical_node_id as "logicalNodeId",
      lnr.node_locator as locator,
      lnr.compatible,
      oe.property_name as "propertyKey",
      po.raw_text as "rawText"
    from dts_occurrence_effects oe
    inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
    inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
    where oe.config_revision_id = $1
      and oe.effect_kind in ('set', 'override')
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

export async function syncPublishedCatalogProjectValues(
  pool: pg.Pool,
  input: {
    organizationId: string;
    projectId: string;
    configSetId: string;
    configRevisionId: string;
  },
  session: WriteSession = pool,
): Promise<number> {
  const snapshot = await loadPublishedCatalog(pool);
  if (!snapshot) {
    return 0;
  }
  const write = asWriteClient(session);
  const writeTarget = isPoolSession(session) ? session : write;
  const observed = await listObservedProperties(write, input.configRevisionId);
  const sourceRef = `config-set:${input.configSetId}`;
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
    const subject = snapshot.resolveSubject({
      driverCompatibles,
      nodeTypeFallback: { kind: "absent" },
    });
    if (subject.status !== "matched") continue;
    const definition = snapshot.getDefinition({
      subjectId: subject.subject.id,
      propertyKey: key,
    });
    if (definition.status !== "found") continue;
    const registrationId = await activeRegistrationId(
      write,
      input.organizationId,
      subject.subject.id,
    );
    if (!registrationId) continue;
    const stabilized = await stabilizeCanonicalBinding(writeTarget, {
      snapshot,
      organizationId: input.organizationId,
      projectId: input.projectId,
      logicalNodeId: row.logicalNodeId,
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
    const writtenBack = await writebackProtectedReference(writeTarget, {
      snapshot,
      binding: stabilized.value.binding,
      definitionRevisionId: definition.definition.selectedRevision.id,
      source: { sourceRef, configRevisionId: input.configRevisionId },
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
    written += 1;
  }
  return written;
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
      from parameter_catalog.project_parameter_bindings
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
    rawText: payloadToBindingView(payload).rawValue,
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
    const view = payloadToBindingView(row.pin.payload);
    const locator = await db.query<{
      node_locator: string | null;
      instance_name: string | null;
      module_id: string | null;
      module_name: string | null;
    }>(
      `
      select
        lnr.node_locator,
        case
          when lnr.unit_address is not null then lnr.name || '@' || lnr.unit_address
          else lnr.name
        end as instance_name,
        placement.module_id,
        module.name as module_name
      from parameter_catalog.project_parameter_bindings b
      left join dts_logical_node_revisions lnr
        on lnr.logical_node_id = b.logical_node_id
       and ($2::text is null or lnr.config_revision_id = $2)
      left join parameter_catalog.organization_subject_registrations registration
        on registration.id = b.registration_id
      left join parameter_catalog.subject_placements placement
        on placement.id = registration.current_placement_id
      left join public.parameter_modules module
        on module.id = placement.module_id
      where b.id = $1
      order by lnr.config_revision_id desc nulls last
      limit 1
      `,
      [row.pin.bindingId, input.revisionId ?? null],
    );
    const loc = locator.rows[0];
    items.push({
      id: row.pin.bindingId,
      parameterSpecId: row.pin.definitionId,
      parameterSpecVersionId: row.pin.definitionRevisionId,
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
};

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

export async function resolveConfigRevisionForSource(
  session: ValueClient,
  input: {
    organizationId: string;
    projectId: string;
    sourceRef: string;
    configRevisionId: string;
  },
): Promise<{ configSetId: string; configRevisionId: string }> {
  const configSetId = parseConfigSetSourceRef(input.sourceRef);
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
  }>(
    `
    select
      b.definition_id as id,
      d.property_key as name,
      b.id as binding_id,
      case
        when v.value_kind = 'number' then trim(both '"' from v.value::text)
        when v.value_kind = 'string' then trim(both '"' from v.value::text)
        else coalesce(v.value::text, '')
      end as current_value
    from parameter_catalog.project_parameter_bindings b
    join parameter_catalog.parameter_definitions d on d.id = b.definition_id
    join parameter_catalog.${VALUES_RELATION} v on v.id = b.current_value_id
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
    configFormat: "DTS",
    module: "",
    range: "",
    unit: "",
    risk: "Low",
    projectParameterValueId: row.binding_id,
    currentValue: row.current_value ?? "",
  }));
}
