import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import { writeTrustedRefusalAudit } from "../audit/auditedWrite";
import type { TrustedAuditEventInput } from "../audit/trustedAudit";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "./trustedInvocation";

export const HUMAN_REQUIRED_INVOCATION_CODE = "trusted-invocation-human-required" as const;

/**
 * Human-required policy is about the trusted execution source, not physical-human detection.
 * Use `requireUserInitiatedInvocationWithRefusalAudit` when the refusal must be recorded;
 * keeping this gate pure preserves a side-effect-free policy seam for callers that already own
 * their transaction and audit ordering.
 */
export function requireUserInitiatedInvocation(context: TrustedInvocationContext): void {
  const trusted = assertTrustedInvocationContext(context);
  if (trusted.initiator === "user") return;

  throw humanRequiredRefusal(trusted);
}

function humanRequiredRefusal(context: Exclude<TrustedInvocationContext, { initiator: "user" }>): ApiError {
  return new ApiError("FORBIDDEN", "This operation requires a user-initiated invocation.", {
    code: HUMAN_REQUIRED_INVOCATION_CODE,
    initiator: context.initiator,
    requireHuman: true
  });
}

/** Enforce human-required policy and persist refusal evidence before returning 403. */
export async function requireUserInitiatedInvocationWithRefusalAudit(
  db: Database,
  input: TrustedAuditEventInput
): Promise<void> {
  const trusted = assertTrustedInvocationContext(input.invocation);
  if (trusted.initiator === "user") return;

  await writeTrustedRefusalAudit(db, input);
  throw humanRequiredRefusal(trusted);
}
