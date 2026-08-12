import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canEditCriticalParameters } from "../parameter-kernel/policy";
import {
  listSensitiveNodeRules,
  matchSensitiveRules,
  type SensitiveNodeRule,
  type SensitiveRiskTier,
  type SensitiveWriteActorType
} from "../parameters/sensitiveNode";

/** Explicit confirmation required when a reload batch includes a critical-tier sensitive match. */
export const SENSITIVE_RELOAD_CONFIRMATION_TOKEN = "confirm-sensitive-reload";

export const SENSITIVE_RELOAD_DENIED_CODE = "sensitive-node-reload-denied";

export type ReloadSensitiveMatchDto = {
  riskTier: SensitiveRiskTier;
  requiredCapability: string;
  ruleId: string;
  matchType: "path" | "compatible";
  pattern: string;
  /** True whenever a rule matches — elevated capability is always required for reload. */
  requiresElevatedCapability: true;
  /** Critical-tier matches also require SENSITIVE_RELOAD_CONFIRMATION_TOKEN at start. */
  requiresConfirmation: boolean;
};

export type ReloadTargetSensitiveHit = {
  bindingId: string;
  propertyKey: string;
  nodePath: string;
  rule: SensitiveNodeRule;
};

export function sensitiveMatchDtoFromRule(rule: SensitiveNodeRule | null): ReloadSensitiveMatchDto | null {
  if (!rule) return null;
  return {
    riskTier: rule.riskTier,
    requiredCapability: rule.requiredCapability,
    ruleId: rule.id,
    matchType: rule.matchType,
    pattern: rule.pattern,
    requiresElevatedCapability: true,
    requiresConfirmation: rule.riskTier === "critical"
  };
}

/**
 * Batch-resolve sensitive matches for many candidates using one rules query.
 * Prefer this for list endpoints.
 */
export async function matchReloadCandidatesSensitive(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    candidates: Array<{ nodePath: string | null; compatible?: string | null }>;
  }
): Promise<Array<ReloadSensitiveMatchDto | null>> {
  const rules = await listSensitiveNodeRules(db, {
    organizationId: input.organizationId,
    projectId: input.projectId
  });
  return input.candidates.map((candidate) => {
    if (!candidate.nodePath?.trim()) return null;
    return sensitiveMatchDtoFromRule(
      matchSensitiveRules(rules, {
        nodePath: candidate.nodePath,
        compatible: candidate.compatible,
        projectId: input.projectId
      })
    );
  });
}

function callerHasRequiredCapability(auth: AuthContext, rule: SensitiveNodeRule) {
  if (rule.requiredCapability === "parameter:edit-critical") {
    return canEditCriticalParameters(auth);
  }
  return auth.user.isActive && auth.permissions.includes(rule.requiredCapability);
}

async function auditSensitiveReloadDenied(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    actorType: SensitiveWriteActorType;
    hit: ReloadTargetSensitiveHit;
    reason: "missing-capability" | "missing-confirmation" | "agent-refused";
    requestId?: string;
  }
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: input.actorType,
    app: "dts-reload",
    kind: "dts-reload-sensitive-node-denied",
    action: "deny",
    severity: "High",
    targetType: "sensitive-node",
    targetId: input.hit.rule.id,
    metadata: {
      code: SENSITIVE_RELOAD_DENIED_CODE,
      reason: input.reason,
      riskTier: input.hit.rule.riskTier,
      requireHuman: input.reason === "agent-refused",
      bindingId: input.hit.bindingId,
      propertyKey: input.hit.propertyKey,
      nodePath: input.hit.nodePath,
      matchType: input.hit.rule.matchType,
      pattern: input.hit.rule.pattern,
      requiredCapability: input.hit.rule.requiredCapability,
      ruleId: input.hit.rule.id
    },
    traceId: input.requestId ?? randomUUID()
  });
}

function denySensitiveReload(
  hit: ReloadTargetSensitiveHit,
  message: string,
  extras: Record<string, unknown>
): never {
  throw new ApiError("FORBIDDEN", message, 403, {
    code: SENSITIVE_RELOAD_DENIED_CODE,
    riskTier: hit.rule.riskTier,
    bindingId: hit.bindingId,
    propertyKey: hit.propertyKey,
    nodePath: hit.nodePath,
    ruleId: hit.rule.id,
    matchType: hit.rule.matchType,
    pattern: hit.rule.pattern,
    requiredCapability: hit.rule.requiredCapability,
    ...extras
  });
}

function hitLabel(hit: ReloadTargetSensitiveHit) {
  return `${hit.propertyKey} (${hit.bindingId})`;
}

/**
 * Gate a resolved reload batch against organisation sensitive-node rules.
 * Call after targets are resolved and before overlay generation / persist.
 */
export async function assertSensitiveReloadBatchAllowed(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    actorType?: SensitiveWriteActorType;
    confirmationToken?: string | null;
    targets: Array<{
      bindingId: string;
      propertyKey: string;
      nodePath: string;
      compatible?: string | null;
    }>;
    requestId?: string;
  }
): Promise<ReloadTargetSensitiveHit[]> {
  const actorType = input.actorType ?? "user";
  const rules = await listSensitiveNodeRules(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });

  const hits: ReloadTargetSensitiveHit[] = [];
  for (const target of input.targets) {
    const matched = matchSensitiveRules(rules, {
      nodePath: target.nodePath,
      compatible: target.compatible,
      projectId: input.projectId
    });
    if (!matched) continue;
    hits.push({
      bindingId: target.bindingId,
      propertyKey: target.propertyKey,
      nodePath: target.nodePath,
      rule: matched
    });
  }

  if (hits.length === 0) return [];

  // Agent actors are refused for any sensitive match on reload (stricter than library writes).
  if (actorType === "agent") {
    const hit = hits[0]!;
    await auditSensitiveReloadDenied(db, auth, {
      projectId: input.projectId,
      actorType,
      hit,
      reason: "agent-refused",
      requestId: input.requestId
    });
    denySensitiveReload(
      hit,
      `Agent actors cannot start reload runs that include sensitive-node parameter ${hitLabel(hit)}.`,
      { requireHuman: true, reason: "agent-refused" }
    );
  }

  for (const hit of hits) {
    if (!callerHasRequiredCapability(auth, hit.rule)) {
      await auditSensitiveReloadDenied(db, auth, {
        projectId: input.projectId,
        actorType,
        hit,
        reason: "missing-capability",
        requestId: input.requestId
      });
      denySensitiveReload(
        hit,
        `Sensitive-node reload of ${hitLabel(hit)} requires ${hit.rule.requiredCapability} in addition to debugging:dts-reload.`,
        { reason: "missing-capability" }
      );
    }
  }

  const criticalHits = hits.filter((hit) => hit.rule.riskTier === "critical");
  if (criticalHits.length > 0 && input.confirmationToken !== SENSITIVE_RELOAD_CONFIRMATION_TOKEN) {
    const hit = criticalHits[0]!;
    await auditSensitiveReloadDenied(db, auth, {
      projectId: input.projectId,
      actorType,
      hit,
      reason: "missing-confirmation",
      requestId: input.requestId
    });
    denySensitiveReload(
      hit,
      `Critical sensitive-node reload of ${hitLabel(hit)} requires confirmationToken "${SENSITIVE_RELOAD_CONFIRMATION_TOKEN}".`,
      {
        reason: "missing-confirmation",
        requireConfirmation: true,
        expectedConfirmationToken: SENSITIVE_RELOAD_CONFIRMATION_TOKEN
      }
    );
  }

  return hits;
}
