import type pg from "pg";

import type { RegistrationCommand } from "./command";
import { validateRegistrationCommand } from "./command";
import type { RegistrationFailure } from "./failures";
import { mapWriterDatabaseError } from "./failures";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import type { RegistrationResult, Result } from "./result";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { assertTrustedInvocationContext, assertTrustedInvocationMatchesScope, TrustedInvocationContextError } from "../../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";

export type RegistrationService = {
  execute(
    command: RegistrationCommand,
  ): Promise<Result<RegistrationResult, RegistrationFailure>>;
};

export function assertRegistrationInvocation(command: Pick<RegistrationCommand, "context" | "organizationId">) {
  const context = command.context;
  const invocation = "invocation" in context ? context.invocation : undefined;
  const requestId = "requestId" in context ? context.requestId : undefined;
  if (invocation) {
    const trusted = assertTrustedInvocationContext(invocation);
    if (trusted.initiator === "system") {
      if (context.actorKind !== "trusted-system" || trusted.identity.name !== context.principalId || !requestId?.trim()) {
        throw new TrustedInvocationContextError("System registration requires its real service and request correlation");
      }
    } else {
      if (trusted.initiator !== "user" || !requestId?.trim() || context.principalId !== trusted.principal.user.id) {
        throw new TrustedInvocationContextError("Organization registration requires its real actor and request correlation");
      }
      assertTrustedInvocationMatchesScope(trusted.principal, trusted, command.organizationId, "organization registration");
    }
  }
  return invocation ? { invocation, requestId: requestId! } : undefined;
}

export async function auditRegistration(client: pg.PoolClient, command: RegistrationCommand, result: RegistrationResult, batchId?: string) {
  const trusted = assertRegistrationInvocation(command);
  if (!trusted || result.outcome !== "committed") return;
  const context = command.context;
  await writeAuditEventInTx(asAuditTx(client), trusted.invocation, { requestId: trusted.requestId }, {
    app: "parameter-governance", kind: "parameter-catalog-registration",
    action: result.replacement ? "registration-replace-placement" : command.kind === "retire-unregistered" ? "registration-retire" : `registration-${command.kind}`, severity: "Medium",
    projectId: null, targetType: "organization-subject-registration", targetId: result.registrationId,
    ...(trusted.invocation.initiator === "system" ? { organizationId: command.organizationId } : {}),
    metadata: { catalogReleaseId: command.expectedRelease.id, actorKind: context.actorKind, ...(batchId ? { batchId } : {}),
      ...(result.cascadedRegistrations?.length ? { cascadedRegistrations: result.cascadedRegistrations } : {}),
      ...(command.kind === "register" && command.displayAlias ? {
        requestedDisplayAlias: command.displayAlias, aliasSubjectId: result.ownerSubjectId ?? result.subjectId,
      } : {}),
      ...(command.kind === "change-owner" ? { reason: command.reason,
        beforeOwnerSubjectId: result.previousOwnerSubjectId, afterOwnerSubjectId: result.ownerSubjectId } : {}),
      ...(command.kind === "move-placement" && command.replacement && result.replacement ? {
        reason: command.replacement.reason,
        source: { registrationId: result.registrationId, placementId: result.placementId,
          subjectId: result.subjectId, beforeModuleId: result.replacement.previousSourceModuleId,
          afterModuleId: result.moduleId, beforePlacementVersion: command.expectedPlacementVersion,
          afterPlacementVersion: result.placementVersion },
        displaced: { ...result.replacement },
      } : {}),
      ...((command.kind === "retire" || command.kind === "restore" || command.kind === "retire-unregistered") ? {
        reason: command.reason, beforeStatus: result.previousRegistrationStatus, afterStatus: result.registrationStatus,
      } : {}) }
  });
}

export const executeRegistration = async (
  pool: pg.Pool,
  command: RegistrationCommand,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const validated = validateRegistrationCommand(command);
  if (!validated.ok) return validated;
  try {
    return await withRegistrationUnitOfWork(pool, async (client) => {
      assertRegistrationInvocation(command);
      const result = await writeGuardedRegistration(client, validated.value);
      if (!result.ok) return result;
      await auditRegistration(client, command, result.value);
      const { cascadedRegistrations: _cascadedRegistrations, ...value } = result.value;
      return { ok: true, value };
    });
  } catch (error) {
    const subjectId =
      command.kind === "register" || command.kind === "retire-unregistered" ? command.subjectId : command.registrationId;
    const mapped = mapWriterDatabaseError(error, command.expectedRelease, subjectId);
    if (mapped) return { ok: false, error: mapped };
    throw error;
  }
};

export const createRegistrationService = (pool: pg.Pool): RegistrationService => ({
  execute: (command) => executeRegistration(pool, command),
});
