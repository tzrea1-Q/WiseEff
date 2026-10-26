import type pg from "pg";

import type { RegistrationCommand } from "./command";
import { validateRegistrationCommand } from "./command";
import type { RegistrationFailure } from "./failures";
import { mapWriterDatabaseError } from "./failures";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import type { RegistrationResult, Result } from "./result";
import { withRegistrationUnitOfWork } from "./unitOfWork";
import { assertTrustedInvocationMatchesScope, TrustedInvocationContextError } from "../../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";

export type RegistrationService = {
  execute(
    command: RegistrationCommand,
  ): Promise<Result<RegistrationResult, RegistrationFailure>>;
};

export const executeRegistration = async (
  pool: pg.Pool,
  command: RegistrationCommand,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const validated = validateRegistrationCommand(command);
  if (!validated.ok) return validated;
  try {
    return await withRegistrationUnitOfWork(pool, async (client) => {
      const context = command.context;
      const invocation = "invocation" in context ? context.invocation : undefined;
      const requestId = "requestId" in context ? context.requestId : undefined;
      if (invocation) {
        const trusted = assertTrustedInvocationMatchesScope(invocation.principal, invocation, command.organizationId, "organization registration");
        if (trusted.initiator !== "user" || context.principalId !== trusted.principal.user.id || !requestId?.trim()) {
          throw new TrustedInvocationContextError("Organization registration requires its real actor and request correlation");
        }
      }
      const result = await writeGuardedRegistration(client, validated.value);
      if (result.ok && result.value.outcome === "committed" && invocation) {
        await writeAuditEventInTx(asAuditTx(client), invocation, { requestId: requestId! }, {
          app: "parameter-governance", kind: "parameter-catalog-registration",
          action: result.value.replacement ? "registration-replace-placement" : command.kind === "retire-unregistered" ? "registration-retire" : `registration-${command.kind}`, severity: "Medium",
          projectId: null, targetType: "organization-subject-registration", targetId: result.value.registrationId,
          metadata: { catalogReleaseId: command.expectedRelease.id, actorKind: context.actorKind,
            ...(command.kind === "move-placement" && command.replacement && result.value.replacement ? {
              reason: command.replacement.reason,
              source: { registrationId: result.value.registrationId, placementId: result.value.placementId,
                subjectId: result.value.subjectId, beforeModuleId: result.value.replacement.previousSourceModuleId,
                afterModuleId: result.value.moduleId, beforePlacementVersion: command.expectedPlacementVersion,
                afterPlacementVersion: result.value.placementVersion },
              displaced: { ...result.value.replacement },
            } : {}),
            ...((command.kind === "retire" || command.kind === "restore" || command.kind === "retire-unregistered") ? {
              reason: command.reason, beforeStatus: result.value.previousRegistrationStatus, afterStatus: result.value.registrationStatus,
            } : {}) }
        });
      }
      return result;
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
