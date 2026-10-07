import { readNodeViaBridge } from "../debugging/bridgeExecution";
import { isDeepStrictEqual } from "node:util";
import type { BridgeRpcClient } from "../deviceBridge/rpc";
import type { Database, Queryable } from "../../shared/database/client";
import {
  compareReloadDebugValue,
  inferReloadValueShape,
  resolveReloadValueShape,
  type CandidateValueShape
} from "./valueShape";
import { payloadToBindingView } from "../parameter-bindings/catalogProjectValueSync";
import type { ProjectValuePayload } from "../parameter-bindings/values";
import type {
  BehaviouralVerificationDto,
  ParameterVerificationRecordDto,
  ReloadRunStatus,
  ReloadRunTargetDto
} from "./types";

export type ParameterVerificationRecord = ParameterVerificationRecordDto;
export type { BehaviouralVerificationDto, ParameterVerificationRecordDto };

export type ResolvedDebugNodeReadBinding = {
  debugNodeId: string;
  nodePath: string;
  accessMode: "RO" | "RW" | "WO";
  valueKind: string;
  valueFormat: string;
  normalizationMode: string;
  maxValueBytes: number | null;
  valueShape: CandidateValueShape;
};

type DebugNodeBindingRow = {
  debug_node_id: string;
  node_path: string;
  access_mode: string;
  value_kind: ProjectValuePayload["kind"];
  value_format: string;
  normalization_mode: string;
  max_value_bytes: number | null;
  value_shape: unknown;
  value_payload: unknown;
  source_locator: unknown;
};

/**
 * Aggregation rules (#287):
 * - zero bound parameters → unverifiable
 * - any contradicted → contradicted (never verified)
 * - every bound parameter verified → verified (behaviourally verified)
 * - bindings present but any read-failed without contradiction → unverifiable
 *   (do not invent success when confirmation is incomplete)
 */
export function aggregateBehaviouralStatus(
  outcomes: ParameterVerificationRecord[]
): Extract<ReloadRunStatus, "verified" | "contradicted" | "unverifiable"> {
  const bound = outcomes.filter((entry) => entry.outcome !== "unbound");
  if (bound.length === 0) return "unverifiable";
  if (bound.some((entry) => entry.outcome === "contradicted")) return "contradicted";
  if (bound.every((entry) => entry.outcome === "verified")) return "verified";
  return "unverifiable";
}

function asValueShape(value: unknown): CandidateValueShape {
  if (!value || typeof value !== "object") return null;
  return value as CandidateValueShape;
}

/**
 * Resolve a readable debug-node binding for a project parameter binding + protocol.
 *
 * Association is exact: the current canonical Binding and its pinned
 * DefinitionRevision/ProjectValue/DTS source pin must match the run target,
 * then `debug_nodes` is joined by its canonical binding + project pair. Runtime
 * path follows `/node-debugging`: enabled `debug_node_bindings` for the deploy
 * protocol. Legacy debugging_parameters and legacy project bindings are never
 * used as an identity fallback.
 */
export async function resolveDebugNodeBindingForReloadTarget(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    bindingId: string;
    definitionId?: string | null;
    definitionRevisionId?: string | null;
    currentValueId?: string | null;
    catalogReleaseId?: string | null;
    configRevisionId?: string | null;
    sourcePinId?: string | null;
    sourceOccurrenceId?: string | null;
    sourceRef?: string | null;
    sourceFormat?: "dts" | "json" | null;
    sourceLocator?: unknown;
    protocol: "hdc" | "adb";
  }
): Promise<ResolvedDebugNodeReadBinding | null> {
  if (
    !input.definitionId ||
    !input.definitionRevisionId ||
    !input.currentValueId ||
    !input.catalogReleaseId ||
    !input.configRevisionId ||
    !input.sourcePinId ||
    !input.sourceOccurrenceId ||
    !input.sourceRef ||
    input.sourceFormat !== "dts" ||
    !input.sourceLocator
  ) {
    return null;
  }
  const result = await db.query<DebugNodeBindingRow>(
    `
    with binding as (
      select id, organization_id, project_id, definition_id, effective_revision_id, current_value_id,
             catalog_release_id
      from parameter_catalog.current_project_parameter_bindings
      where organization_id = $1
        and project_id = $2
        and id = $4
        and definition_id = $5
        and effective_revision_id = $6
        and current_value_id = $7
        and catalog_release_id = $8
      limit 1
    )
    select
      dn.id as debug_node_id,
      dnb.node_path,
      dnb.access_mode,
      dn.value_kind,
      dn.value_format,
      dn.normalization_mode,
      dn.max_value_bytes,
      revision.content -> 'valueShape' as value_shape,
      value.value_kind,
      value.value as value_payload,
      pin.locator as source_locator
    from binding b
    join parameter_catalog.project_parameter_values value
      on value.id = b.current_value_id
     and value.binding_id = b.id
     and value.definition_id = b.definition_id
     and value.definition_revision_id = b.effective_revision_id
     and value.source_ref = $9
     and value.config_revision_id = $10
    join parameter_catalog.definition_revisions revision
      on revision.id = b.effective_revision_id
     and revision.definition_id = b.definition_id
     and revision.catalog_release_id = b.catalog_release_id
    join parameter_catalog.project_value_source_pins pin
      on pin.id = $11
     and pin.project_value_id = value.id
     and pin.binding_id = b.id
     and pin.definition_id = b.definition_id
     and pin.organization_id = b.organization_id
     and pin.project_id = b.project_id
     and pin.source_occurrence_id = $12
     and pin.config_revision_id = $10
     and pin.format = 'dts'
    join debug_nodes dn
      on dn.canonical_binding_id = b.id
     and dn.organization_id = b.organization_id
     and dn.canonical_project_id = b.project_id
    join debug_node_bindings dnb
      on dnb.node_id = dn.id
     and dnb.organization_id = dn.organization_id
    where dnb.protocol = $3
      and dnb.enabled = true
      and dn.enabled = true
      and dn.archived_at is null
      and dnb.access_mode in ('RO', 'RW')
    limit 2
    `,
    [
      input.organizationId,
      input.projectId,
      input.protocol,
      input.bindingId,
      input.definitionId,
      input.definitionRevisionId,
      input.currentValueId,
      input.catalogReleaseId,
      input.sourceRef,
      input.configRevisionId,
      input.sourcePinId,
      input.sourceOccurrenceId
    ]
  );

  // A canonical binding may have multiple enabled debug nodes for the same
  // protocol. There is no safe name-based winner, so ambiguity is
  // unverifiable rather than silently reading the wrong node.
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  if (!isDeepStrictEqual(input.sourceLocator, row.source_locator)) return null;
  if (row.access_mode !== "RO" && row.access_mode !== "RW") return null;
  const view = payloadToBindingView(
    { kind: row.value_kind, value: row.value_payload } as ProjectValuePayload,
    "dts"
  );
  const valueShape = asValueShape(row.value_shape) ??
    (view.typedValue.kind === "json" ? null : inferReloadValueShape(view.typedValue));

  return {
    debugNodeId: row.debug_node_id,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    valueKind: row.value_kind,
    valueFormat: row.value_format,
    normalizationMode: row.normalization_mode,
    maxValueBytes: row.max_value_bytes === null || row.max_value_bytes === undefined ? null : Number(row.max_value_bytes),
    valueShape: resolveReloadValueShape(valueShape, view.rawValue)
  };
}

function preserveExactReadForNode(binding: ResolvedDebugNodeReadBinding): boolean {
  return (
    binding.normalizationMode === "exact" || binding.normalizationMode === "line-ending-normalized"
  );
}

export async function verifyReloadTargetsBehaviourally(input: {
  db: Database | Queryable;
  organizationId: string;
  projectId: string;
  targets: ReloadRunTargetDto[];
  protocol: "hdc" | "adb";
  bridgeId: string;
  targetRef: string;
  bridgeRpcClient: Pick<BridgeRpcClient, "call">;
  readTimeoutMs: number;
}): Promise<{
  status: Extract<ReloadRunStatus, "verified" | "contradicted" | "unverifiable">;
  behaviouralVerification: BehaviouralVerificationDto;
}> {
  const outcomes: ParameterVerificationRecord[] = [];

  for (const target of input.targets) {
    try {
      const binding = await resolveDebugNodeBindingForReloadTarget(input.db, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        bindingId: target.bindingId,
        definitionId: target.canonicalDefinitionId,
        definitionRevisionId: target.canonicalDefinitionRevisionId,
        currentValueId: target.canonicalCurrentValueId,
        catalogReleaseId: target.canonicalCatalogReleaseId,
        configRevisionId: target.canonicalConfigRevisionId,
        sourcePinId: target.canonicalSourcePinId,
        sourceOccurrenceId: target.canonicalSourceOccurrenceId,
        sourceRef: target.canonicalSourceRef,
        sourceFormat: target.canonicalSourceFormat,
        sourceLocator: target.canonicalSourceLocator,
        protocol: input.protocol
      });

      if (!binding) {
        outcomes.push({
          bindingId: target.bindingId,
          propertyKey: target.propertyKey,
          outcome: "unbound",
          debugNodeId: null,
          nodePath: null,
          expectedValue: target.debugValue,
          readValue: null,
          reason: "No readable debug-node binding for this parameter and protocol."
        });
        continue;
      }

      const readResult = await readNodeViaBridge({
        rpc: input.bridgeRpcClient,
        bridgeId: input.bridgeId,
        protocol: input.protocol,
        targetRef: input.targetRef,
        nodePath: binding.nodePath,
        preserveExactRead: preserveExactReadForNode(binding),
        timeoutMs: input.readTimeoutMs
      });

      if (!readResult.ok) {
        outcomes.push({
          bindingId: target.bindingId,
          propertyKey: target.propertyKey,
          outcome: "read-failed",
          debugNodeId: binding.debugNodeId,
          nodePath: binding.nodePath,
          expectedValue: target.debugValue,
          readValue: null,
          reason: readResult.error?.trim() || "Debug-node read failed."
        });
        continue;
      }

      const readValue = (readResult.value ?? readResult.stdout ?? "").toString();
      const compare = compareReloadDebugValue({
        propertyKey: target.propertyKey,
        debugValue: target.debugValue,
        readValue,
        valueShape: binding.valueShape
      });

      if (compare === "incomparable") {
        outcomes.push({
          bindingId: target.bindingId,
          propertyKey: target.propertyKey,
          outcome: "read-failed",
          debugNodeId: binding.debugNodeId,
          nodePath: binding.nodePath,
          expectedValue: target.debugValue,
          readValue,
          reason:
            "Debug-node read-back could not be interpreted under the parameter's declared value shape."
        });
        continue;
      }

      outcomes.push({
        bindingId: target.bindingId,
        propertyKey: target.propertyKey,
        outcome: compare === "matched" ? "verified" : "contradicted",
        debugNodeId: binding.debugNodeId,
        nodePath: binding.nodePath,
        expectedValue: target.debugValue,
        readValue,
        reason:
          compare === "matched"
            ? null
            : "Driver surface value does not match the debug value under the parameter's value shape."
      });
    } catch (error) {
      outcomes.push({
        bindingId: target.bindingId,
        propertyKey: target.propertyKey,
        outcome: "read-failed",
        debugNodeId: null,
        nodePath: null,
        expectedValue: target.debugValue,
        readValue: null,
        reason:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Behavioural verification failed unexpectedly for this parameter."
      });
    }
  }

  return {
    status: aggregateBehaviouralStatus(outcomes),
    behaviouralVerification: { outcomes }
  };
}

export function parseBehaviouralVerification(value: unknown): BehaviouralVerificationDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outcomesRaw = (value as { outcomes?: unknown }).outcomes;
  if (!Array.isArray(outcomesRaw)) return null;

  const outcomes: ParameterVerificationRecord[] = [];
  for (const entry of outcomesRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const outcome = record.outcome;
    if (
      outcome !== "verified" &&
      outcome !== "contradicted" &&
      outcome !== "unbound" &&
      outcome !== "read-failed"
    ) {
      continue;
    }
    outcomes.push({
      bindingId: typeof record.bindingId === "string" ? record.bindingId : "",
      propertyKey: typeof record.propertyKey === "string" ? record.propertyKey : "",
      outcome,
      debugNodeId: typeof record.debugNodeId === "string" ? record.debugNodeId : null,
      nodePath: typeof record.nodePath === "string" ? record.nodePath : null,
      expectedValue: typeof record.expectedValue === "string" ? record.expectedValue : "",
      readValue: typeof record.readValue === "string" ? record.readValue : null,
      reason: typeof record.reason === "string" ? record.reason : null
    });
  }
  return { outcomes };
}
