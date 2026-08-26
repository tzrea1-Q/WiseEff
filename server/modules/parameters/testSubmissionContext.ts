import type { AuthContext } from "../auth/types";
import { createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { testRefusalAuditSink } from "../audit/testRefusalSink";
import type { ParameterSubmissionContext } from "./service";

export function createTestParameterSubmissionContext(
  auth: AuthContext,
  requestId = "test-parameter-submission",
  invocation: TrustedInvocationContext = createUserInvocation(auth)
): ParameterSubmissionContext {
  return { invocation, requestId, refusalSink: testRefusalAuditSink };
}
