import type { Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import {
  assertTrustedInvocationMatchesAuth,
  TrustedInvocationContextError,
  type AgentInvocationContext,
  type TrustedInvocationContext
} from "../auth/trustedInvocation";
import {
  getAgentApproval,
  getAgentSession,
  getAgentToolCall,
  type AgentApprovalRecord,
  type AgentSessionRecord,
  type AgentToolCallRecord
} from "./repository";
import { parseDtsValue } from "../dts/valueAst";
import { parseJsonSource } from "../parameter-files/jsonSource";
import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";

/** Durable payload key used to retain the server-resolved approval pins. */
export const APPROVED_PARAMETER_PAYLOAD_KEY = "approvedParameter" as const;

export type ApprovedParameterTarget = {
  format: "dts" | "json";
  sourceText: string;
};

/**
 * Exact canonical identity captured before the human approval decision. These
 * values travel in the durable Agent tool-call payload; they are deliberately
 * not stored in the trusted invocation checkpoint.
 */
export type ApprovedParameterPins = {
  projectId: string;
  bindingId: string;
  expectedValueId: string;
  definitionId: string;
  definitionRevisionId: string;
  catalogReleaseId: string;
  configRevisionId: string;
  sourceRef: string;
  sourcePinId: string;
  sourceFormat: "dts" | "json";
};

export type ApprovedParameterPayload = ApprovedParameterPins & {
  target: ApprovedParameterTarget;
};

export type ApprovedParameterInvocation = {
  invocation: AgentInvocationContext;
  session: AgentSessionRecord;
  toolCall: AgentToolCallRecord;
  approval: AgentApprovalRecord;
  payload: Record<string, unknown>;
  pins: ApprovedParameterPins;
  target: ApprovedParameterTarget;
};

type ApprovedParameterInput = {
  invocation: TrustedInvocationContext;
  projectId: string;
  bindingId: string;
  target: ApprovedParameterTarget;
  expectedValueId: string;
};

function fail(reason: string): never {
  throw new TrustedInvocationContextError(`approved parameter invocation ${reason}`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${field} is missing`);
  }
  return value;
}

function requiredFormat(value: unknown, field: string): "dts" | "json" {
  if (value === "dts" || value === "json") return value;
  return fail(`${field} must be dts or json`);
}

function normalizedDts(value: string): string {
  const parsed = parseDtsValue("_approved_parameter", value).value;
  return JSON.stringify(stripDtsLayout(parsed));
}

function stripDtsLayout(value: ReturnType<typeof parseDtsValue>["value"]): unknown {
  switch (value.kind) {
    case "boolean":
      return { kind: "boolean", present: true };
    case "empty":
      return { kind: "empty" };
    case "strings":
      return { kind: "strings", values: value.values };
    case "bytes":
      return { kind: "bytes", values: value.values };
    case "cells":
      return {
        kind: "cells",
        bits: value.bits,
        groups: value.groups.map((group) =>
          group.map((cell) => (cell.kind === "integer"
            ? { kind: "integer", value: cell.value }
            : { kind: "phandle", label: cell.label }))
        )
      };
    case "mixed":
      return {
        kind: "mixed",
        segments: value.segments.map((segment) =>
          segment.kind === "string"
            ? { kind: "string", value: segment.value }
            : {
                kind: "cells",
                bits: segment.bits,
                cells: segment.cells.map((cell) => (cell.kind === "integer"
                  ? { kind: "integer", value: cell.value }
                  : { kind: "phandle", label: cell.label }))
              }
        )
      };
  }
}

function normalizedJson(value: string): string {
  return serializeContract(parseJsonSource(value) as ContractJsonValue);
}

function normalizedTarget(target: ApprovedParameterTarget): string {
  try {
    return target.format === "dts" ? normalizedDts(target.sourceText) : normalizedJson(target.sourceText);
  } catch {
    return fail(`target is invalid ${target.format} source`);
  }
}

function assertTargetEqual(left: ApprovedParameterTarget, right: ApprovedParameterTarget, field: string) {
  if (left.format !== right.format || normalizedTarget(left) !== normalizedTarget(right)) {
    return fail(`${field} does not match the approved target`);
  }
}

function parseApprovedPayload(payload: Record<string, unknown>): ApprovedParameterPayload {
  const value = record(payload[APPROVED_PARAMETER_PAYLOAD_KEY]);
  if (!value) return fail("durable canonical pins are missing");
  const sourceFormat = requiredFormat(value.sourceFormat, "sourceFormat");
  const targetValue = record(value.target);
  if (!targetValue) return fail("target is missing");
  const target = {
    format: requiredFormat(targetValue.format, "target.format"),
    sourceText: requiredString(targetValue.sourceText, "target.sourceText")
  } satisfies ApprovedParameterTarget;
  if (target.format !== sourceFormat) return fail("target format does not match source format");
  return {
    projectId: requiredString(value.projectId, "projectId"),
    bindingId: requiredString(value.bindingId, "bindingId"),
    expectedValueId: requiredString(value.expectedValueId, "expectedValueId"),
    definitionId: requiredString(value.definitionId, "definitionId"),
    definitionRevisionId: requiredString(value.definitionRevisionId, "definitionRevisionId"),
    catalogReleaseId: requiredString(value.catalogReleaseId, "catalogReleaseId"),
    configRevisionId: requiredString(value.configRevisionId, "configRevisionId"),
    sourceRef: requiredString(value.sourceRef, "sourceRef"),
    sourcePinId: requiredString(value.sourcePinId, "sourcePinId"),
    sourceFormat,
    target
  };
}

/**
 * Prove that an approved Agent action is the exact durable action reaching a
 * canonical source/draft owner. Call this inside the caller's transaction.
 * The helper intentionally accepts only the small source-owner target/base
 * seam; downstream draft submission compares the returned pins as well.
 */
export async function requireApprovedParameterInvocation(
  db: Queryable,
  auth: AuthContext,
  input: ApprovedParameterInput
): Promise<ApprovedParameterInvocation> {
  const trusted = assertTrustedInvocationMatchesAuth(auth, input.invocation, "canonical parameter action");
  if (trusted.initiator !== "agent" || !trusted.approvalRequired || !trusted.approvalId) {
    return fail("must be a server-owned approved Agent invocation");
  }
  const invocation = trusted;
  const approvalId = invocation.approvalId;
  if (!approvalId) return fail("must carry an approval id");

  const session = await getAgentSession(db, auth.organization.id, invocation.sessionId);
  if (!session || session.organizationId !== auth.organization.id || session.actorUserId !== auth.user.id) {
    return fail("session actor or organization does not match auth");
  }
  if (session.projectId !== undefined && session.projectId !== input.projectId) {
    return fail("session project does not match the approved project");
  }

  const toolCall = await getAgentToolCall(db, auth.organization.id, invocation.toolCallId);
  if (
    !toolCall ||
    toolCall.organizationId !== auth.organization.id ||
    toolCall.sessionId !== session.id ||
    (toolCall.projectId !== undefined && toolCall.projectId !== input.projectId) ||
    toolCall.name !== "action.submitParameterChange" ||
    !toolCall.requiresApproval ||
    !["pending_approval", "running"].includes(toolCall.status)
  ) {
    return fail("tool call is not the pending approved parameter action");
  }

  const approval = await getAgentApproval(db, auth.organization.id, approvalId);
  if (
    !approval ||
    approval.organizationId !== auth.organization.id ||
    (approval.projectId !== undefined && approval.projectId !== input.projectId) ||
    approval.status !== "approved" ||
    approval.sessionId !== session.id ||
    approval.toolCallId !== toolCall.id ||
    toolCall.approvalId !== approval.id ||
    approval.requestedByUserId !== session.actorUserId ||
    approval.decidedByUserId !== auth.user.id
  ) {
    return fail("approval status, actor, decider, or linkage is invalid");
  }

  const durable = parseApprovedPayload(toolCall.payload);
  if (durable.projectId !== input.projectId || durable.bindingId !== input.bindingId) {
    return fail("project or binding does not match the approved payload");
  }
  if (durable.expectedValueId !== input.expectedValueId) {
    return fail("expected canonical value does not match the approved payload");
  }

  const payloadProjectId = requiredString(toolCall.payload.projectId, "payload.projectId");
  const payloadBindingId = requiredString(toolCall.payload.parameterId, "payload.parameterId");
  const payloadTargetValue = requiredString(toolCall.payload.targetValue, "payload.targetValue");
  if (payloadProjectId !== input.projectId || payloadBindingId !== input.bindingId) {
    return fail("payload scope does not match the approved action");
  }
  assertTargetEqual(
    { format: durable.sourceFormat, sourceText: payloadTargetValue },
    input.target,
    "payload.targetValue"
  );
  assertTargetEqual(durable.target, input.target, "durable target");

  return {
    invocation,
    session,
    toolCall,
    approval,
    payload: toolCall.payload,
    pins: {
      projectId: durable.projectId,
      bindingId: durable.bindingId,
      expectedValueId: durable.expectedValueId,
      definitionId: durable.definitionId,
      definitionRevisionId: durable.definitionRevisionId,
      catalogReleaseId: durable.catalogReleaseId,
      configRevisionId: durable.configRevisionId,
      sourceRef: durable.sourceRef,
      sourcePinId: durable.sourcePinId,
      sourceFormat: durable.sourceFormat
    },
    target: durable.target
  };
}
