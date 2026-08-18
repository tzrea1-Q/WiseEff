import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { getAgentApproval, getAgentToolCall } from "../agent/repository";

/** Reserved Agent tool name for a device node write. Not in the Xiaoze catalog yet. */
export const DEVICE_WRITE_AGENT_TOOL = "action.writeDebugNode";
/** Reserved Agent tool name for a snapshot rollback. Not in the Xiaoze catalog yet. */
export const DEVICE_ROLLBACK_AGENT_TOOL = "action.rollbackDebugSnapshot";

const WRITE_INVALID = "Device write approval is not valid for this write.";
const ROLLBACK_INVALID = "Device rollback approval is not valid for this snapshot.";

function organizationIdFor(auth: AuthContext) {
  return auth.organization.id || auth.user.organizationId;
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function writeIdentityMatches(
  payload: Record<string, unknown>,
  write: { sessionId: string; parameterId?: string; nodeId?: string; value: string }
): boolean {
  if (payloadString(payload, "sessionId") !== write.sessionId) {
    return false;
  }
  if (payloadString(payload, "value") !== write.value) {
    return false;
  }
  if (write.nodeId?.trim()) {
    return payloadString(payload, "nodeId") === write.nodeId.trim();
  }
  if (write.parameterId?.trim()) {
    return payloadString(payload, "parameterId") === write.parameterId.trim();
  }
  return false;
}

async function loadApprovedDeviceToolCall(
  db: Queryable,
  auth: AuthContext,
  approvalId: string,
  expectedToolName: string,
  invalidMessage: string
) {
  const organizationId = organizationIdFor(auth);
  const approval = await getAgentApproval(db, organizationId, approvalId);
  if (!approval) {
    throw new ApiError("VALIDATION_FAILED", invalidMessage, { approvalId, reason: "not-found" });
  }
  if (approval.status !== "approved") {
    throw new ApiError("VALIDATION_FAILED", invalidMessage, { approvalId, reason: "not-approved" });
  }
  if (approval.requestedByUserId !== auth.user.id) {
    throw new ApiError("VALIDATION_FAILED", invalidMessage, { approvalId, reason: "write-mismatch" });
  }
  const toolCall = await getAgentToolCall(db, organizationId, approval.toolCallId);
  if (!toolCall) {
    throw new ApiError("VALIDATION_FAILED", invalidMessage, { approvalId, reason: "not-found" });
  }
  if (toolCall.name !== expectedToolName) {
    throw new ApiError("VALIDATION_FAILED", invalidMessage, { approvalId, reason: "tool-mismatch" });
  }
  return toolCall;
}

export async function assertApprovedDeviceWrite(
  db: Queryable,
  auth: AuthContext,
  approvalId: string,
  write: { sessionId: string; parameterId?: string; nodeId?: string; value: string }
) {
  const toolCall = await loadApprovedDeviceToolCall(db, auth, approvalId, DEVICE_WRITE_AGENT_TOOL, WRITE_INVALID);
  if (!writeIdentityMatches(toolCall.payload, write)) {
    throw new ApiError("VALIDATION_FAILED", WRITE_INVALID, { approvalId, reason: "write-mismatch" });
  }
}

export async function assertApprovedDeviceRollback(
  db: Queryable,
  auth: AuthContext,
  approvalId: string,
  snapshotId: string
) {
  const toolCall = await loadApprovedDeviceToolCall(
    db,
    auth,
    approvalId,
    DEVICE_ROLLBACK_AGENT_TOOL,
    ROLLBACK_INVALID
  );
  if (payloadString(toolCall.payload, "snapshotId") !== snapshotId) {
    throw new ApiError("VALIDATION_FAILED", ROLLBACK_INVALID, { approvalId, reason: "write-mismatch" });
  }
}

export async function assertDeviceWriteAuthorization(
  db: Queryable,
  auth: AuthContext,
  input: {
    risk: "Low" | "Medium" | "High";
    sessionId: string;
    parameterId?: string;
    nodeId?: string;
    value: string;
    confirmationToken?: string;
    approvalId?: string;
  }
) {
  const approvalId = input.approvalId?.trim();
  if (approvalId) {
    await assertApprovedDeviceWrite(db, auth, approvalId, input);
    return;
  }
  if (input.risk === "High" && input.confirmationToken !== "confirm-high-risk-write") {
    throw new ApiError("VALIDATION_FAILED", "High-risk write requires confirmation or approval.");
  }
}

export async function assertDeviceRollbackAuthorization(
  db: Queryable,
  auth: AuthContext,
  input: { snapshotId: string; confirmationToken?: string; approvalId?: string }
) {
  const approvalId = input.approvalId?.trim();
  if (approvalId) {
    await assertApprovedDeviceRollback(db, auth, approvalId, input.snapshotId);
    return;
  }
  if (input.confirmationToken !== "confirm-rollback") {
    throw new ApiError("VALIDATION_FAILED", "Rollback confirmation is required.");
  }
}
