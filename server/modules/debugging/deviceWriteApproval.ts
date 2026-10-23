import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { createAgentInvocation, createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { getAgentApproval, getAgentToolCall, updateAgentToolCall } from "../agent/repository";

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
  const lifecycle = await db.query(`select id from public.organizations where id=$1 and status='active'
    and (suspended_at is null or suspended_at<$2::timestamptz)`, [organizationId, approval.createdAt]);
  if (!lifecycle.rowCount) throw new ApiError("VALIDATION_FAILED", "组织停用后，原设备审批已失效，请重新申请并确认操作。", { approvalId, reason: "organization-lifecycle-changed" });
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
  await claimDeviceApproval(db, auth, approvalId, toolCall.id, WRITE_INVALID);
  return toolCall;
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
  await claimDeviceApproval(db, auth, approvalId, toolCall.id, ROLLBACK_INVALID);
  return toolCall;
}

async function claimDeviceApproval(db: Queryable, auth: AuthContext, approvalId: string, toolCallId: string, message: string) {
  // The conditional transition holds the row lock until the device operation and its audit commit.
  const claimed = await updateAgentToolCall(db, organizationIdFor(auth), toolCallId, {
    status: "running", expectedStatus: "pending_approval"
  });
  if (!claimed) {
    throw new ApiError("VALIDATION_FAILED", message, { approvalId, reason: "already-executed" });
  }
}

export async function completeDeviceApproval(db: Queryable, invocation: TrustedInvocationContext, failed: boolean) {
  if (invocation.initiator !== "agent") return;
  const completed = await updateAgentToolCall(db, organizationIdFor(invocation.principal), invocation.toolCallId, {
    status: failed ? "failed" : "succeeded", expectedStatus: "running"
  });
  if (!completed) {
    throw new ApiError("CONFLICT", "Device approval execution could not be completed.");
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
): Promise<TrustedInvocationContext> {
  const approvalId = input.approvalId?.trim();
  if (approvalId) {
    const toolCall = await assertApprovedDeviceWrite(db, auth, approvalId, input);
    return createAgentInvocation(auth, {
      sessionId: toolCall.sessionId,
      toolCallId: toolCall.id,
      approval: { required: true, approvalId }
    });
  }
  if (input.risk === "High" && input.confirmationToken !== "confirm-high-risk-write") {
    throw new ApiError("VALIDATION_FAILED", "High-risk write requires confirmation or approval.");
  }
  return createUserInvocation(auth);
}

export async function assertDeviceRollbackAuthorization(
  db: Queryable,
  auth: AuthContext,
  input: { snapshotId: string; confirmationToken?: string; approvalId?: string }
): Promise<TrustedInvocationContext> {
  const approvalId = input.approvalId?.trim();
  if (approvalId) {
    const toolCall = await assertApprovedDeviceRollback(db, auth, approvalId, input.snapshotId);
    return createAgentInvocation(auth, {
      sessionId: toolCall.sessionId,
      toolCallId: toolCall.id,
      approval: { required: true, approvalId }
    });
  }
  if (input.confirmationToken !== "confirm-rollback") {
    throw new ApiError("VALIDATION_FAILED", "Rollback confirmation is required.");
  }
  return createUserInvocation(auth);
}
