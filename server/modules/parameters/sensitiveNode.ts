import { randomUUID } from "node:crypto";
import { createAuditEvent } from "../audit/repository";
import type { AuthContext, BackendPermission } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canEditCriticalParameters } from "./policy";
import { nodePathFromSourceNodePath } from "./impact";

export type SensitiveRiskTier = "high" | "critical";
export type SensitiveMatchType = "path" | "compatible";
export type SensitiveWriteActorType = "user" | "agent" | "system";

export type SensitiveNodeRule = {
  id: string;
  organizationId: string;
  projectId: string | null;
  matchType: SensitiveMatchType;
  pattern: string;
  riskTier: SensitiveRiskTier;
  requiredCapability: BackendPermission;
  enabled: boolean;
};

type SensitiveNodeRuleRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  match_type: SensitiveMatchType;
  pattern: string;
  risk_tier: SensitiveRiskTier;
  required_capability: string;
  enabled: boolean;
};

const riskRank: Record<SensitiveRiskTier, number> = {
  high: 1,
  critical: 2
};

function escapeRegex(value: string) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string) {
  const escaped = escapeRegex(pattern).replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(pattern: string, value: string) {
  return patternToRegExp(pattern).test(value);
}

function toRule(row: SensitiveNodeRuleRow): SensitiveNodeRule {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    matchType: row.match_type,
    pattern: row.pattern,
    riskTier: row.risk_tier,
    requiredCapability: row.required_capability as BackendPermission,
    enabled: row.enabled
  };
}

export function matchSensitiveRules(
  rules: SensitiveNodeRule[],
  input: { nodePath: string; compatible?: string | null; projectId: string }
): SensitiveNodeRule | null {
  const nodePath = input.nodePath.trim();
  const parentNodePath = nodePathFromSourceNodePath(nodePath);
  const candidates = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.projectId != null && rule.projectId !== input.projectId) return false;

    if (rule.matchType === "path") {
      return matchesPattern(rule.pattern, nodePath) || matchesPattern(rule.pattern, parentNodePath);
    }

    const compatible = input.compatible?.trim();
    if (!compatible) return false;
    return matchesPattern(rule.pattern, compatible);
  });

  if (candidates.length === 0) return null;

  return candidates.reduce((best, current) =>
    riskRank[current.riskTier] > riskRank[best.riskTier] ? current : best
  );
}

async function listSensitiveNodeRules(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<SensitiveNodeRule[]> {
  const result = await db.query<SensitiveNodeRuleRow>(
    `
    select
      id,
      organization_id,
      project_id,
      match_type,
      pattern,
      risk_tier,
      required_capability,
      enabled
    from dts_sensitive_node_rules
    where organization_id = $1
      and enabled = true
      and (project_id is null or project_id = $2)
    `,
    [input.organizationId, input.projectId]
  );
  return result.rows.map(toRule);
}

/** Resolve dts_nodes.compatible for a parameter source when structural model is available. */
export async function resolveDtsNodeCompatible(
  db: Queryable,
  input: { projectId: string; sourceFileName: string; sourceNodePath: string }
): Promise<string | null> {
  const nodePath = nodePathFromSourceNodePath(input.sourceNodePath.trim());
  const result = await db.query<{ compatible: string | null }>(
    `
    select n.compatible
    from project_parameter_files f
    inner join project_parameter_file_versions v on v.id = f.current_version_id
    inner join dts_nodes n on n.file_version_id = v.id
    where f.project_id = $1
      and f.file_name = $2
      and (n.node_path = $3 or n.node_path = $4)
    order by case when n.node_path = $3 then 0 else 1 end
    limit 1
    `,
    [input.projectId, input.sourceFileName, nodePath, input.sourceNodePath.trim()]
  );
  return result.rows[0]?.compatible ?? null;
}

function hasRequiredCapability(auth: AuthContext, capability: BackendPermission) {
  if (capability === "parameter:edit-critical") {
    return canEditCriticalParameters(auth);
  }
  return auth.user.isActive && auth.permissions.includes(capability);
}

export async function assertSensitiveNodeWriteAllowed(
  db: Queryable,
  auth: AuthContext,
  input: {
    organizationId: string;
    projectId: string;
    nodePath: string;
    sourceFileName?: string | null;
    compatible?: string | null;
    actorType: SensitiveWriteActorType;
    requestId?: string;
  }
) {
  const nodePath = input.nodePath.trim();
  if (!nodePath) return;

  let compatible = input.compatible?.trim() || null;
  const sourceFileName = input.sourceFileName?.trim() || null;
  if (!compatible && sourceFileName) {
    compatible = await resolveDtsNodeCompatible(db, {
      projectId: input.projectId,
      sourceFileName,
      sourceNodePath: nodePath
    });
  }

  const rules = await listSensitiveNodeRules(db, {
    organizationId: input.organizationId,
    projectId: input.projectId
  });
  const matched = matchSensitiveRules(rules, {
    nodePath,
    compatible,
    projectId: input.projectId
  });
  if (!matched) return;

  if (input.actorType === "agent" && matched.riskTier === "critical") {
    await createAuditEvent(db, {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      actorUserId: auth.user.id,
      actorType: "agent",
      app: "parameter-management",
      kind: "parameter-sensitive-node-denied",
      action: "deny",
      severity: "High",
      targetType: "sensitive-node",
      targetId: matched.id,
      metadata: {
        riskTier: matched.riskTier,
        requireHuman: true,
        nodePath,
        matchType: matched.matchType,
        pattern: matched.pattern,
        requiredCapability: matched.requiredCapability
      },
      traceId: input.requestId ?? randomUUID()
    });
    throw new ApiError(
      "FORBIDDEN",
      "Agent writes to critical sensitive nodes require a human.",
      403,
      {
        riskTier: matched.riskTier,
        requireHuman: true,
        nodePath,
        requiredCapability: matched.requiredCapability
      }
    );
  }

  if (!hasRequiredCapability(auth, matched.requiredCapability)) {
    throw new ApiError(
      "FORBIDDEN",
      `Missing permission: ${matched.requiredCapability}.`,
      403,
      {
        riskTier: matched.riskTier,
        nodePath,
        requiredCapability: matched.requiredCapability
      }
    );
  }
}
