import { randomUUID } from "node:crypto";
import { createAuditEvent } from "../audit/repository";
import { writeRefusalAudit } from "../audit/auditedWrite";
import { assertTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import {
  assertTrustedInvocationMatchesAuth,
  TrustedInvocationContextError,
  type TrustedInvocationContext
} from "../auth/trustedInvocation";
import type { Database } from "../../shared/database/client";
import type { AuthContext, BackendPermission } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canEditCriticalParameters } from "./policy";
import { nodePathFromSourceNodePath } from "./nodePath";

export type SensitiveRiskTier = "high" | "critical";
export type SensitiveMatchType = "path" | "compatible";
export type SensitiveWriteActorType = "user" | "agent" | "system";
export const PARAMETER_SENSITIVE_NODE_HUMAN_REQUIRED_CODE = "parameter-sensitive-node-human-required" as const;
export const PARAMETER_ACCOUNTABLE_USER_REQUIRED_CODE = "parameter-accountable-user-required" as const;
export const PARAMETER_SENSITIVE_NODE_IDENTITY_MISMATCH_CODE =
  "parameter-sensitive-node-identity-mismatch" as const;

/**
 * The source path's meaning is part of the trusted server contract. A node
 * locator names the complete structural node and must match exactly. A
 * property path names a property below a node and may explicitly resolve its
 * owning node by removing the property segment.
 */
export type SensitiveNodeSourcePath =
  | { kind: "node-locator"; value: string }
  | { kind: "property-path"; value: string };

export type TrustedSensitiveNodeWriteContext = {
  invocation: TrustedInvocationContext;
  requestId: string;
  refusalSink: TrustedRefusalAuditSink;
};

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
  input: {
    nodePath: string;
    compatible?: string | null;
    projectId: string;
    /**
     * A complete node locator is matched exactly. Only a property path may
     * explicitly resolve a rule on its owning node.
     */
    sourcePathKind?: SensitiveNodeSourcePath["kind"];
  }
): SensitiveNodeRule | null {
  const nodePath = input.nodePath.trim();
  const parentNodePath = nodePathFromSourceNodePath(nodePath);
  const allowParentMatch = input.sourcePathKind !== "node-locator";
  const candidates = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.projectId != null && rule.projectId !== input.projectId) return false;

    if (rule.matchType === "path") {
      return matchesPattern(rule.pattern, nodePath) ||
        (allowParentMatch && matchesPattern(rule.pattern, parentNodePath));
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

export async function listSensitiveNodeRules(
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

/** Resolve the highest-tier sensitive rule matching a node (path and/or compatible). */
export async function resolveSensitiveNodeMatch(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    nodePath: string;
    compatible?: string | null;
    sourcePathKind?: SensitiveNodeSourcePath["kind"];
  }
): Promise<SensitiveNodeRule | null> {
  const nodePath = input.nodePath.trim();
  if (!nodePath) return null;

  const rules = await listSensitiveNodeRules(db, {
    organizationId: input.organizationId,
    projectId: input.projectId
  });
  return matchSensitiveRules(rules, {
    nodePath,
    compatible: input.compatible,
    projectId: input.projectId,
    sourcePathKind: input.sourcePathKind ?? "property-path"
  });
}

/** Resolve dts_nodes.compatible for a parameter source when structural model is available. */
export async function resolveDtsNodeCompatible(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    sourceFileName: string;
    sourcePath: SensitiveNodeSourcePath;
    sourceFileVersionId?: string | null;
  }
): Promise<string | null> {
  const sourcePathValue = input.sourcePath.value.trim();
  const sourceFileName = input.sourceFileName.trim();
  const nodePath =
    input.sourcePath.kind === "property-path"
      ? nodePathFromSourceNodePath(sourcePathValue)
      : sourcePathValue;
  if (!nodePath) {
    throw new ApiError("CONFLICT", "Exact source node identity is empty.", {
      code: PARAMETER_SENSITIVE_NODE_IDENTITY_MISMATCH_CODE,
      projectId: input.projectId,
      sourceFileName,
      sourceFileVersionId: input.sourceFileVersionId ?? null,
      sourcePath: sourcePathValue,
    });
  }
  const sourceFileVersionId = input.sourceFileVersionId?.trim() || null;
  if (sourceFileVersionId) {
    const scope = await db.query<{ file_id: string; file_version_id: string; format: "dts" | "json" }>(
      `
      select f.id as file_id, v.id as file_version_id, f.format
      from project_parameter_files f
      inner join project_parameter_file_versions v
        on v.file_id = f.id
       and v.id = $4
      where f.organization_id = $1
        and f.project_id = $2
        and f.file_name = $3
      limit 1
      `,
      [
        input.organizationId,
        input.projectId,
        sourceFileName,
        sourceFileVersionId,
      ]
    );
    const scoped = scope.rows[0];
    if (!scoped) {
      throw new ApiError("CONFLICT", "Exact source file version does not belong to the requested file scope.", {
        code: "parameter-sensitive-source-version-mismatch",
        projectId: input.projectId,
        sourceFileName,
        sourceFileVersionId,
        nodePath
      });
    }
    // JSON sources have no DTS structural node table.  Their path-only rules
    // remain governed by the persisted source path, while DTS sources require
    // an exact structural identity before compatible matching is attempted.
    if (scoped.format !== "dts") return null;
    const exact = await db.query<{ node_id: string; compatible: string | null }>(
      `
      select n.id as node_id, n.compatible
      from project_parameter_files f
      inner join project_parameter_file_versions v
        on v.file_id = f.id
       and v.id = $4
      inner join dts_nodes n
        on n.file_version_id = v.id
       and n.node_path = $5
      where f.organization_id = $1
        and f.project_id = $2
        and f.file_name = $3
      limit 1
      `,
      [input.organizationId, input.projectId, sourceFileName, sourceFileVersionId, nodePath]
    );
    if (!exact.rows[0]) {
      throw new ApiError("CONFLICT", "Exact source node identity was not found in the locked file version.", {
        code: PARAMETER_SENSITIVE_NODE_IDENTITY_MISMATCH_CODE,
        projectId: input.projectId,
        sourceFileName,
        sourceFileVersionId,
        nodePath,
        sourcePathKind: input.sourcePath.kind,
      });
    }
    // A persisted node with compatible NULL is a valid no-compatible result;
    // only a missing node identity is a conflict.
    return exact.rows[0].compatible;
  }

  const lookupPath = input.sourcePath.kind === "node-locator" ? sourcePathValue : nodePath;
  const result = await db.query<{ compatible: string | null }>(
    `
    select n.compatible
    from project_parameter_files f
    inner join project_parameter_file_versions v on v.id = f.current_version_id
    inner join dts_nodes n on n.file_version_id = v.id
    where f.organization_id = $1
      and f.project_id = $2
      and f.file_name = $3
      and n.node_path = $4
    limit 1
    `,
    [input.organizationId, input.projectId, sourceFileName, lookupPath]
  );
  return result.rows[0]?.compatible ?? null;
}

function hasRequiredCapability(auth: AuthContext, capability: BackendPermission) {
  if (capability === "parameter:edit-critical") {
    return canEditCriticalParameters(auth);
  }
  return auth.user.isActive && auth.permissions.includes(capability);
}

async function resolveTrustedSensitiveNodeMatch(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    nodePath: string;
    sourceFileName?: string | null;
    sourceFileVersionId?: string | null;
    sourcePath?: SensitiveNodeSourcePath;
    compatible?: string | null;
    /** True when compatible (including null) came from an exact server-owned logical-node revision. */
    compatibleIsAuthoritative?: boolean;
  }
) {
  const nodePath = input.nodePath.trim();
  if (!nodePath) return null;
  let compatible = input.compatible?.trim() || null;
  const hasSourceFileName = input.sourceFileName !== undefined && input.sourceFileName !== null;
  const sourceFileName = input.sourceFileName?.trim() || null;
  const sourceFileVersionId = input.sourceFileVersionId?.trim() || null;
  if (!input.compatibleIsAuthoritative && (hasSourceFileName || sourceFileVersionId)) {
    if (!sourceFileName || !sourceFileVersionId) {
      throw new ApiError("CONFLICT", "Trusted sensitive-node writes require an exact source file version.", {
        code: "parameter-sensitive-source-version-mismatch",
        projectId: input.projectId,
        sourceFileName,
        sourceFileVersionId,
        nodePath,
      });
    }
  }
  // A source file/version held by a server-side lock is the only compatible
  // authority for writeback.  Ignore any caller-supplied compatible value and
  // resolve it from that exact persisted version; only topology revision
  // callers may explicitly mark their persisted compatible as authoritative.
  if (!input.compatibleIsAuthoritative && sourceFileName && sourceFileVersionId) {
    compatible = await resolveDtsNodeCompatible(db, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceFileName,
      sourcePath: input.sourcePath ?? { kind: "property-path", value: nodePath },
      sourceFileVersionId
    });
  }
  const rules = await listSensitiveNodeRules(db, {
    organizationId: input.organizationId,
    projectId: input.projectId
  });
  const matched = matchSensitiveRules(rules, {
    nodePath,
    compatible,
    projectId: input.projectId,
    sourcePathKind: input.sourcePath?.kind ?? "node-locator"
  });
  return matched ? { matched, nodePath } : null;
}

export function assertTrustedSensitiveNodeWriteContext<T extends TrustedSensitiveNodeWriteContext>(
  auth: AuthContext,
  context: T | undefined,
  operation: string
): T {
  if (!context || typeof context.requestId !== "string" || context.requestId.trim().length === 0) {
    throw new TrustedInvocationContextError(
      `${operation} requires a requestId, server-owned refusal audit sink, and trusted invocation context`
    );
  }
  assertTrustedRefusalAuditSink(context.refusalSink);
  const invocation = assertTrustedInvocationMatchesAuth(auth, context.invocation, operation);
  return { ...context, invocation, requestId: context.requestId.trim() };
}

/** Shared trusted-provenance guard for parameter-sensitive production writes. */
export async function assertTrustedSensitiveNodeWriteAllowed(
  db: Queryable,
  auth: AuthContext,
  input: {
    organizationId: string;
    projectId: string;
    nodePath: string;
    sourceFileName?: string | null;
    sourceFileVersionId?: string | null;
    sourcePath?: SensitiveNodeSourcePath;
    compatible?: string | null;
    compatibleIsAuthoritative?: boolean;
    invocation: TrustedInvocationContext;
    requestId: string;
    refusalSink: TrustedRefusalAuditSink;
  }
) {
  const trustedContext = assertTrustedSensitiveNodeWriteContext(auth, input, "parameter sensitive-node write");
  if (input.organizationId.trim() !== auth.organization.id) {
    throw new TrustedInvocationContextError(
      "parameter sensitive-node write organization does not match the authenticated target scope"
    );
  }
  const invocation = trustedContext.invocation;
  const resolved = await resolveTrustedSensitiveNodeMatch(db, input);
  if (!resolved) return;
  const { matched, nodePath } = resolved;

  if (!hasRequiredCapability(auth, matched.requiredCapability)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${matched.requiredCapability}.`, {
      riskTier: matched.riskTier,
      nodePath,
      requiredCapability: matched.requiredCapability
    });
  }

  if (matched.riskTier === "critical" && invocation.initiator !== "user") {
    await input.refusalSink.write({
      invocation,
      ...(invocation.initiator === "system" ? { organizationId: input.organizationId } : {}),
      projectId: input.projectId,
      app: "parameter-management",
      kind: "parameter-sensitive-node-denied",
      action: "deny",
      severity: "High",
      targetType: "sensitive-node",
      targetId: matched.id,
      metadata: {
        code: PARAMETER_SENSITIVE_NODE_HUMAN_REQUIRED_CODE,
        riskTier: matched.riskTier,
        requireHuman: true,
        nodePath,
        matchType: matched.matchType,
        pattern: matched.pattern,
        requiredCapability: matched.requiredCapability
      },
      traceId: trustedContext.requestId
    });
    throw new ApiError("FORBIDDEN", "Critical sensitive-node submissions require a user-initiated invocation.", {
      code: PARAMETER_SENSITIVE_NODE_HUMAN_REQUIRED_CODE,
      initiator: invocation.initiator,
      riskTier: matched.riskTier,
      requireHuman: true,
      nodePath,
      requiredCapability: matched.requiredCapability
    });
  }

}

/** Fail closed when a legacy user-owned domain row cannot truthfully represent System. */
export async function requireTrustedAccountableUser(
  auth: AuthContext,
  input: TrustedSensitiveNodeWriteContext & {
    organizationId: string;
    projectId: string;
    operation: string;
    targetType: string;
    targetId: string;
  }
): Promise<AuthContext["user"]> {
  const trusted = assertTrustedSensitiveNodeWriteContext(auth, input, input.operation);
  if (trusted.invocation.initiator !== "system") {
    return trusted.invocation.principal.user;
  }
  await trusted.refusalSink.write({
    invocation: trusted.invocation,
    organizationId: input.organizationId,
    projectId: input.projectId,
    app: "parameter-management",
    kind: "parameter-accountable-user-denied",
    action: "deny",
    severity: "High",
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: {
      code: PARAMETER_ACCOUNTABLE_USER_REQUIRED_CODE,
      operation: input.operation,
      reason: "user-owned-domain-record"
    },
    traceId: trusted.requestId
  });
  throw new ApiError("FORBIDDEN", "This workflow requires an accountable user principal.", {
    code: PARAMETER_ACCOUNTABLE_USER_REQUIRED_CODE,
    initiator: "system",
    operation: input.operation
  });
}

/** #613 compatibility name; #615 owns final legacy API cleanup. */
export const assertTrustedSensitiveNodeSubmissionAllowed = assertTrustedSensitiveNodeWriteAllowed;

export async function assertSensitiveNodeWriteAllowed(
  db: Queryable,
  auth: AuthContext,
  input: {
    organizationId: string;
    projectId: string;
    nodePath: string;
    sourceFileName?: string | null;
    sourceFileVersionId?: string | null;
    sourcePath?: SensitiveNodeSourcePath;
    compatible?: string | null;
    actorType: SensitiveWriteActorType;
    requestId?: string;
  },
  deps: {
    /**
     * Pool handle for the deny audit. When this guard runs inside a caller's
     * transaction (merge, structured-edit submit), the refusal evidence must be
     * written OUTSIDE that transaction or the rollback triggered by the throw
     * erases it. Callers in a transaction must pass the pool `Database`; the
     * `db` fallback only preserves behavior for the callers that already run
     * outside any transaction.
     */
    refusalDb?: Database;
  } = {}
) {
  const nodePath = input.nodePath.trim();
  if (!nodePath) return;

  let compatible = input.compatible?.trim() || null;
  const sourceFileName = input.sourceFileName?.trim() || null;
  if (!compatible && sourceFileName) {
    compatible = await resolveDtsNodeCompatible(db, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceFileName,
      sourcePath: input.sourcePath ?? { kind: "property-path", value: nodePath },
      sourceFileVersionId: input.sourceFileVersionId
    });
  }

  const rules = await listSensitiveNodeRules(db, {
    organizationId: input.organizationId,
    projectId: input.projectId
  });
  const matched = matchSensitiveRules(rules, {
    nodePath,
    compatible,
    projectId: input.projectId,
    sourcePathKind: input.sourcePath?.kind ?? "property-path"
  });
  if (!matched) return;

  if (input.actorType === "agent" && matched.riskTier === "critical") {
    if (deps.refusalDb) {
      await writeRefusalAudit(deps.refusalDb, auth, { requestId: input.requestId ?? randomUUID() }, {
        app: "parameter-management",
        kind: "parameter-sensitive-node-denied",
        action: "deny",
        severity: "High",
        projectId: input.projectId,
        targetType: "sensitive-node",
        targetId: matched.id,
        actorType: "agent",
        metadata: {
          riskTier: matched.riskTier,
          requireHuman: true,
          nodePath,
          matchType: matched.matchType,
          pattern: matched.pattern,
          requiredCapability: matched.requiredCapability
        }
      });
    } else {
      // Transitional: callers that have not wired a pool handle yet keep the old
      // behavior (deny audit on `db` — lost if `db` is a transaction that rolls back).
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
    }
    throw new ApiError(
      "FORBIDDEN",
      "Agent writes to critical sensitive nodes require a human.",
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
      {
        riskTier: matched.riskTier,
        nodePath,
        requiredCapability: matched.requiredCapability
      }
    );
  }
}
