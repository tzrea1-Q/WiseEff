import { readNodeViaBridge } from "../debugging/bridgeExecution";
import type { BridgeRpcClient } from "../deviceBridge/rpc";
import type { Database, Queryable } from "../../shared/database/client";
import { compareReloadDebugValue, type CandidateValueShape } from "./valueShape";
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
  value_kind: string;
  value_format: string;
  normalization_mode: string;
  max_value_bytes: number | null;
  value_shape: unknown;
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
 * Association: `debugging_parameters.project_parameter_binding_id` (preferred) or
 * `debugging_parameters.parameter_spec_id` matching the binding's spec — the topology
 * migration backfill path. Runtime path then follows `/node-debugging`:
 * `debug_nodes` + enabled `debug_node_bindings` for the deploy protocol.
 */
export async function resolveDebugNodeBindingForReloadTarget(
  db: Queryable,
  input: {
    organizationId: string;
    bindingId: string;
    protocol: "hdc" | "adb";
  }
): Promise<ResolvedDebugNodeReadBinding | null> {
  const result = await db.query<DebugNodeBindingRow>(
    `
    with binding as (
      select id, parameter_spec_id, organization_id
      from project_parameter_bindings
      where organization_id = $1
        and id = $2
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
      psv.value_shape as value_shape
    from binding b
    join debugging_parameters dp
      on dp.organization_id = b.organization_id
     and (
       dp.project_parameter_binding_id = b.id
       or (
         dp.parameter_spec_id is not null
         and dp.parameter_spec_id = b.parameter_spec_id
       )
     )
    join debug_nodes dn
      on dn.id = dp.id
     and dn.organization_id = dp.organization_id
    join debug_node_bindings dnb
      on dnb.node_id = dn.id
     and dnb.organization_id = dn.organization_id
    left join lateral (
      select psv.value_shape
      from project_parameter_binding_revisions br
      join parameter_spec_versions psv on psv.id = br.parameter_spec_version_id
      where br.binding_id = b.id
      order by br.created_at desc
      limit 1
    ) psv on true
    where dnb.protocol = $3
      and dnb.enabled = true
      and dn.enabled = true
      and dn.archived_at is null
      and dnb.access_mode in ('RO', 'RW')
    order by
      case when dp.project_parameter_binding_id = b.id then 0 else 1 end,
      dn.name asc
    limit 1
    `,
    [input.organizationId, input.bindingId, input.protocol]
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.access_mode !== "RO" && row.access_mode !== "RW") return null;

  return {
    debugNodeId: row.debug_node_id,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    valueKind: row.value_kind,
    valueFormat: row.value_format,
    normalizationMode: row.normalization_mode,
    maxValueBytes: row.max_value_bytes === null || row.max_value_bytes === undefined ? null : Number(row.max_value_bytes),
    valueShape: asValueShape(row.value_shape)
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
        bindingId: target.bindingId,
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
