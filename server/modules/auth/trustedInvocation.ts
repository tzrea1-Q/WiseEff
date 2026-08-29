import { BACKEND_PERMISSIONS, BACKEND_ROLE_IDS, type AuthContext } from "./types";

const trustedInvocationBrand = Symbol("wiseeff.trusted-invocation");

type TrustedInvocationBrand = {
  readonly [trustedInvocationBrand]: true;
};

export type AgentInvocationApproval =
  | { required: false }
  | { required: true; approvalId: string };

export type AgentInvocationInput = {
  sessionId: string;
  toolCallId: string;
  approval: AgentInvocationApproval;
};

export type SystemInvocationInput = {
  kind: "service" | "job";
  name: string;
};

export type UserInvocationContext = {
  readonly initiator: "user";
  readonly principal: AuthContext;
} & TrustedInvocationBrand;

export type AgentInvocationContext = {
  readonly initiator: "agent";
  readonly principal: AuthContext;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly approvalRequired: boolean;
  readonly approvalId: string | null;
} & TrustedInvocationBrand;

export type SystemInvocationContext = {
  readonly initiator: "system";
  readonly identity: Readonly<SystemInvocationInput>;
} & TrustedInvocationBrand;

export type TrustedInvocationContext = UserInvocationContext | AgentInvocationContext | SystemInvocationContext;

/**
 * Projection used by #614 domain rows.  `userId` is the accountable principal
 * (null for System), while initiator metadata identifies the actual executor.
 * It is intentionally derived only after the trusted brand has been checked.
 */
export type TrustedInvocationDomainAttribution = Readonly<{
  userId: string | null;
  /** True only for a server-owned Agent row whose accountable user was deleted. */
  principalDeleted: boolean;
  initiatorType: TrustedInvocationContext["initiator"];
  systemKind: SystemInvocationInput["kind"] | null;
  systemName: string | null;
  sessionId: string | null;
  toolCallId: string | null;
  approvalId: string | null;
}>;

/**
 * Shared shape for an internal SQL row projection.  Public DTOs must never
 * use this type: the correlation fields are durable evidence for policy,
 * audit, and transaction code only.
 */
export type TrustedInvocationDomainAttributionRow = Readonly<{
  /** Identity-free server-owned marker retained after an Agent user's deletion. */
  initiator_principal_deleted?: boolean | null;
  initiator_type?: TrustedInvocationContext["initiator"] | "legacy" | null;
  initiator_system_kind?: SystemInvocationInput["kind"] | null;
  initiator_system_name?: string | null;
  initiator_session_id?: string | null;
  initiator_tool_call_id?: string | null;
  initiator_approval_id?: string | null;
}>;

export type PersistedInvocationDomainAttribution = Readonly<{
  userId: string | null;
  principalDeleted: boolean;
  initiatorType: TrustedInvocationContext["initiator"] | "legacy";
  systemKind: SystemInvocationInput["kind"] | null;
  systemName: string | null;
  sessionId: string | null;
  toolCallId: string | null;
  approvalId: string | null;
}>;

const backendRoleIds = new Set<string>(BACKEND_ROLE_IDS);
const backendPermissions = new Set<string>(BACKEND_PERMISSIONS);

export const TRUSTED_INVOCATION_CONTEXT_ERROR_CODE = "INVALID_TRUSTED_INVOCATION_CONTEXT" as const;

export class TrustedInvocationContextError extends Error {
  readonly code = TRUSTED_INVOCATION_CONTEXT_ERROR_CODE;

  constructor(readonly reason: string) {
    super(`Invalid trusted invocation context: ${reason}`);
    this.name = "TrustedInvocationContextError";
  }
}

function invalid(reason: string): never {
  throw new TrustedInvocationContextError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalid(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateAuthContext(value: unknown): asserts value is AuthContext {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.organization)) {
    invalid("principal must be an AuthContext");
  }

  const user = value.user;
  const organization = value.organization;
  nonEmptyString(user.id, "principal.user.id");
  const userOrganizationId = nonEmptyString(user.organizationId, "principal.user.organizationId");
  const organizationId = nonEmptyString(organization.id, "principal.organization.id");
  nonEmptyString(user.name, "principal.user.name");
  nonEmptyString(user.title, "principal.user.title");
  nonEmptyString(organization.name, "principal.organization.name");

  if (userOrganizationId !== organizationId) {
    invalid("principal user and organization must belong to the same Organization");
  }
  if (typeof user.isActive !== "boolean") {
    invalid("principal.user.isActive must be a boolean");
  }
  if (user.email !== undefined && typeof user.email !== "string") {
    invalid("principal.user.email must be a string when present");
  }
  if (user.emailVerified !== undefined && typeof user.emailVerified !== "boolean") {
    invalid("principal.user.emailVerified must be a boolean when present");
  }
  if (user.username !== undefined && typeof user.username !== "string") {
    invalid("principal.user.username must be a string when present");
  }
  if (!Array.isArray(value.roles) || !Array.isArray(value.permissions)) {
    invalid("principal roles and permissions must be arrays");
  }
  if (
    !Array.from(value.roles).every(
      (role) =>
        isRecord(role) &&
        (role.projectId === null || (typeof role.projectId === "string" && role.projectId.trim().length > 0)) &&
        typeof role.roleId === "string" &&
        backendRoleIds.has(role.roleId)
    )
  ) {
    invalid("principal roles are malformed");
  }
  if (
    !Array.from(value.permissions).every(
      (permission) => typeof permission === "string" && backendPermissions.has(permission)
    )
  ) {
    invalid("principal permissions are malformed");
  }
}

function snapshotAuthContext(principal: AuthContext): AuthContext {
  return Object.freeze({
    user: Object.freeze({ ...principal.user }),
    organization: Object.freeze({ ...principal.organization }),
    roles: Object.freeze(principal.roles.map((role) => Object.freeze({ ...role }))),
    permissions: Object.freeze([...principal.permissions])
  }) as AuthContext;
}

function brand<T extends object>(value: T): T & TrustedInvocationBrand {
  const branded = { ...value };
  Object.defineProperty(branded, trustedInvocationBrand, { value: true, enumerable: false });
  return Object.freeze(branded) as T & TrustedInvocationBrand;
}

function validateAgentInvocationInput(value: unknown): AgentInvocationInput {
  if (!isRecord(value) || !isRecord(value.approval)) {
    return invalid("Agent invocation requires session, tool-call, and approval correlation");
  }

  const sessionId = nonEmptyString(value.sessionId, "agent.sessionId");
  const toolCallId = nonEmptyString(value.toolCallId, "agent.toolCallId");
  const approval = value.approval;

  if (approval.required === true) {
    const approvalId = nonEmptyString(approval.approvalId, "agent.approval.approvalId");
    return { sessionId, toolCallId, approval: { required: true, approvalId } };
  }
  if (approval.required === false && !Object.hasOwn(approval, "approvalId")) {
    return { sessionId, toolCallId, approval: { required: false } };
  }

  return invalid("agent.approval must explicitly declare required=true with approvalId or required=false");
}

function validateSystemInvocationInput(value: unknown): SystemInvocationInput {
  if (!isRecord(value) || (value.kind !== "service" && value.kind !== "job")) {
    return invalid("system identity kind must be service or job");
  }
  return { kind: value.kind, name: nonEmptyString(value.name, "system.name") };
}

export function createUserInvocation(principal: AuthContext): UserInvocationContext {
  validateAuthContext(principal);
  return brand({ initiator: "user" as const, principal: snapshotAuthContext(principal) });
}

export function createAgentInvocation(principal: AuthContext, input: AgentInvocationInput): AgentInvocationContext {
  validateAuthContext(principal);
  const validated = validateAgentInvocationInput(input);
  return brand({
    initiator: "agent" as const,
    principal: snapshotAuthContext(principal),
    sessionId: validated.sessionId,
    toolCallId: validated.toolCallId,
    approvalRequired: validated.approval.required,
    approvalId: validated.approval.required ? validated.approval.approvalId : null
  });
}

export function createSystemInvocation(input: SystemInvocationInput): SystemInvocationContext {
  const identity = validateSystemInvocationInput(input);
  return brand({ initiator: "system" as const, identity: Object.freeze(identity) });
}

function validateBrandedContext(value: unknown): TrustedInvocationContext {
  if (!isRecord(value) || (value as Record<PropertyKey, unknown>)[trustedInvocationBrand] !== true || !Object.isFrozen(value)) {
    return invalid("context must come from a server-owned constructor");
  }

  if (value.initiator === "user") {
    validateAuthContext(value.principal);
    return value as UserInvocationContext;
  }

  if (value.initiator === "agent") {
    validateAuthContext(value.principal);
    nonEmptyString(value.sessionId, "agent.sessionId");
    nonEmptyString(value.toolCallId, "agent.toolCallId");
    if (typeof value.approvalRequired !== "boolean") {
      return invalid("agent.approvalRequired must be a boolean");
    }
    if (value.approvalRequired) {
      nonEmptyString(value.approvalId, "agent.approvalId");
    } else if (value.approvalId !== null) {
      return invalid("agent.approvalId must be null when approval is not required");
    }
    return value as AgentInvocationContext;
  }

  if (value.initiator === "system") {
    if (!isRecord(value.identity)) {
      return invalid("system identity is malformed");
    }
    const identityValue = value.identity;
    const identity = validateSystemInvocationInput(identityValue);
    if (!Object.isFrozen(identityValue)) {
      return invalid("system identity must be immutable");
    }
    if (Object.hasOwn(value, "principal")) {
      return invalid("system invocation must not contain a synthetic principal");
    }
    if (identity.name !== identityValue.name) {
      return invalid("system identity cannot be changed after construction");
    }
    return value as SystemInvocationContext;
  }

  return invalid("initiator must be user, agent, or system");
}

/** Validate the server-owned brand before a sensitive policy or write is reached. */
export function assertTrustedInvocationContext(value: unknown): TrustedInvocationContext {
  return validateBrandedContext(value);
}

/** Validate both server ownership and the authenticated principal boundary. */
export function assertTrustedInvocationMatchesAuth(
  auth: AuthContext,
  value: unknown,
  operation: string
): TrustedInvocationContext {
  const invocation = assertTrustedInvocationContext(value);
  if (
    invocation.initiator !== "system" &&
    (invocation.principal.user.id !== auth.user.id ||
      invocation.principal.organization.id !== auth.organization.id ||
      invocation.principal.user.organizationId !== auth.organization.id)
  ) {
    throw new TrustedInvocationContextError(
      `${operation} invocation principal does not match the authenticated principal`
    );
  }
  return invocation;
}

/** Mutating #614 seams require complete Agent correlation, including approval. */
export function assertTrustedMutationInvocation(
  value: TrustedInvocationContext,
  operation = "trusted mutation"
): TrustedInvocationContext {
  const invocation = assertTrustedInvocationContext(value);
  if (invocation.initiator === "agent" && (!invocation.approvalId || invocation.approvalId.trim().length === 0)) {
    throw new TrustedInvocationContextError(`${operation} Agent invocation requires a non-empty approvalId`);
  }
  return invocation;
}

/** Accountable authorization principal for domain rows; System has no user principal. */
export function trustedAccountableUser(value: TrustedInvocationContext): AuthContext["user"] | null {
  const invocation = assertTrustedInvocationContext(value);
  return invocation.initiator === "system" ? null : invocation.principal.user;
}

/** Return the truthful domain attribution for a trusted invocation. */
export function trustedDomainAttribution(value: TrustedInvocationContext): TrustedInvocationDomainAttribution {
  const invocation = assertTrustedInvocationContext(value);
  if (invocation.initiator === "system") {
    return {
      userId: null,
      principalDeleted: false,
      initiatorType: "system",
      systemKind: invocation.identity.kind,
      systemName: invocation.identity.name,
      sessionId: null,
      toolCallId: null,
      approvalId: null
    };
  }
  if (invocation.initiator === "agent") {
    return {
      userId: invocation.principal.user.id,
      principalDeleted: false,
      initiatorType: "agent",
      systemKind: null,
      systemName: null,
      sessionId: invocation.sessionId,
      toolCallId: invocation.toolCallId,
      approvalId: invocation.approvalId
    };
  }
  return {
    userId: invocation.principal.user.id,
    principalDeleted: false,
    initiatorType: "user",
    systemKind: null,
    systemName: null,
    sessionId: null,
    toolCallId: null,
    approvalId: null
  };
}

/** Convert one internal SQL projection into a durable-domain attribution. */
export function trustedDomainAttributionFromRow(
  row: TrustedInvocationDomainAttributionRow,
  userId: string | null | undefined
): PersistedInvocationDomainAttribution {
  const principalDeleted = row.initiator_principal_deleted === true;
  return {
    // A deleted marker is deliberately identity-free. Never recover a user id
    // from any snapshot or tombstone; the FK is the sole accountable-principal
    // source and is null after permanent deletion.
    userId: principalDeleted ? null : userId ?? null,
    principalDeleted,
    initiatorType: row.initiator_type ?? "legacy",
    systemKind: row.initiator_system_kind ?? null,
    systemName: row.initiator_system_name ?? null,
    sessionId: row.initiator_session_id ?? null,
    toolCallId: row.initiator_tool_call_id ?? null,
    approvalId: row.initiator_approval_id ?? null,
  };
}

/**
 * Stable public display projection.  Internal correlation and System names
 * remain available only through the trusted domain/audit projection.
 */
export function trustedPublicExecutionLabel(value: TrustedInvocationContext): string {
  const invocation = assertTrustedInvocationContext(value);
  return trustedPublicExecutionLabelFromAttribution(
    trustedDomainAttribution(invocation),
    invocation.initiator === "user" ? invocation.principal.user.name : ""
  );
}

/**
 * Public display projection for an already persisted attribution row.  This
 * deliberately accepts only the discriminant and System kind: correlation
 * ids and System names never cross the public DTO/notification boundary.
 */
export function trustedPublicExecutionLabelFromAttribution(
  attribution:
    | {
        initiatorType: TrustedInvocationDomainAttribution["initiatorType"] | "legacy";
        systemKind: TrustedInvocationDomainAttribution["systemKind"];
      }
    | undefined,
  userFallback = ""
): string {
  if (!attribution || attribution.initiatorType === "user" || attribution.initiatorType === "legacy") {
    return userFallback;
  }
  if (attribution.initiatorType === "agent") return "WiseEff Agent";
  return `WiseEff System ${attribution.systemKind ?? "service"}`;
}
