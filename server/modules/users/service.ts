import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext, BackendRoleId, RoleBinding } from "../auth/types";
import { assertTrustedInvocationContext, createUserInvocation, type TrustedInvocationContext, type UserInvocationContext } from "../auth/trustedInvocation";
import {
  checkProjectBelongsToOrg,
  deleteUserById,
  decideRegistrationRoleRequest,
  getPendingRegistrationRoleRequestByIdForAdmin,
  getPendingRegistrationRoleRequestById,
  getOrganizationById,
  getProjectWorkflowRoleBindings,
  getUserById,
  getUserOrganizationRoles,
  getUserProjectWorkflowRoles,
  findPasswordCredentialByUsername,
  listActiveAdminUserIds,
  listRegistrationRoleRequestsByScope,
  insertUser,
  insertPasswordCredential,
  lockUserById,
  updateOrganizationRoles,
  updatePasswordCredential,
  updateProjectWorkflowRoles,
  listUsers,
  replaceRoleBindings,
  updateOrganizationName,
  updateUser,
  updateUserActive
} from "./repository";
import { notifyRegistrationRoleDecided, notifyUserDeactivated, notifyUserRoleChanged } from "../notifications/producers";
import { revokeLocalUserSessions } from "../auth/localAuth";
import type {
  CreateUserInput,
  RegistrationRoleRequestListStatus,
  ProjectWorkflowRoleBindingsDto,
  ProjectWorkflowRoleId,
  ReplaceUserRolesInput,
  UpdateOrganizationInput,
  UpdateOrganizationRolesInput,
  UpdateProjectWorkflowRoleBindingsInput,
  ResetUserPasswordInput,
  UpdateUserActiveInput,
  UpdateUserProfileInput
} from "./types";
import { organizationNameMaxLength } from "./schemas";
import { listProjectMembers } from "../projects/members";
import { setOidcIdentity } from "../auth/oidcIdentity";
import { assertAdministratorContinuity, hasOrganizationRole, lockAdministratorMutation, type AdministratorMutationContext } from "./administratorContinuity";

const roleIds = new Set<BackendRoleId>([
  "guest",
  "hardware-user",
  "software-user",
  "hardware-committer",
  "software-committer",
  "admin",
  "platform-admin"
]);
const scryptAsync = promisify(scrypt);
const passwordHashPrefix = "scrypt";

type GovernanceCaller = AuthContext | UserInvocationContext;
function governanceScope(caller: GovernanceCaller) {
  const invocation = "initiator" in caller ? assertTrustedInvocationContext(caller) : createUserInvocation(caller);
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "User management requires a user invocation.");
  return { auth: invocation.principal, invocation, organizationId: invocation.operatingOrganization?.id ?? invocation.principal.organization.id };
}

function requireUserManager(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("users:manage")) {
    throw new ApiError("FORBIDDEN", "User management permission is required.", { permission: "users:manage" });
  }
}

function requireOrgAdmin(auth: AuthContext) {
  if (!auth.user.isActive) {
    throw new ApiError("FORBIDDEN", "User is inactive.");
  }
  if (!auth.permissions.includes("users:manage")) {
    throw new ApiError("FORBIDDEN", "User management permission is required.", { permission: "users:manage" });
  }
  const hasHomeAdmin = auth.roles.some(
    (r) => r.projectId === null && (r.roleId === "admin" || r.roleId === "platform-admin")
  );
  if (!hasHomeAdmin) {
    throw new ApiError("FORBIDDEN", "Organization administrator authority is required.");
  }
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeRoles(roles: ReplaceUserRolesInput["roles"]): RoleBinding[] {
  return roles.map((role) => {
    if (!roleIds.has(role.roleId)) {
      throw new ApiError("VALIDATION_FAILED", "Role id is not supported.", { roleId: role.roleId });
    }

    return { projectId: role.projectId ?? null, roleId: role.roleId };
  });
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function requireUsername(username: string) {
  if (!username) {
    throw new ApiError("VALIDATION_FAILED", "Username is required.");
  }
  if (username.length < 3 || username.length > 64) {
    throw new ApiError("VALIDATION_FAILED", "Username must be 3 to 64 characters.");
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new ApiError("VALIDATION_FAILED", "Username can only contain letters, numbers, dots, underscores, or hyphens.");
  }
}

function requirePasswordPolicy(password: string) {
  if (password.length < 8) {
    throw new ApiError("VALIDATION_FAILED", "Password must be at least 8 characters.");
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${passwordHashPrefix}$${salt}$${derived.toString("base64url")}`;
}

function callerHasPlatformAdmin(auth: AuthContext) {
  return hasOrganizationRole(auth.roles, "platform-admin");
}

function rolesIncludePlatformAdmin(roles: RoleBinding[]) {
  return hasOrganizationRole(roles, "platform-admin");
}

function assertPlatformAdminGrantAllowed(auth: AuthContext, currentRoles: RoleBinding[], nextRoles: RoleBinding[]) {
  const currentHasPlatformAdmin = rolesIncludePlatformAdmin(currentRoles);
  const nextHasPlatformAdmin = rolesIncludePlatformAdmin(nextRoles);
  if (currentHasPlatformAdmin === nextHasPlatformAdmin) {
    return;
  }

  if (!callerHasPlatformAdmin(auth)) {
    throw new ApiError(
      "FORBIDDEN",
      "Only a platform super admin may grant or revoke the platform-admin role.",
      { roleId: "platform-admin" }
    );
  }
}

async function auditUserMutation(
  tx: AuditTx,
  invocation: TrustedInvocationContext,
  input: {
    kind: "user-create" | "user-update" | "user-activation" | "user-role-replace" | "user-password-reset" | "user-delete";
    action: "create" | "update" | "activate" | "deactivate" | "replace-roles" | "reset-password" | "delete";
    userId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  // requestId fallback survives only until user-governance contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, invocation, { requestId: context.requestId ?? randomUUID() }, {
    app: "user-governance",
    kind: input.kind,
    action: input.action,
    severity: "High",
    projectId: null,
    targetType: "user",
    targetId: input.userId,
    metadata: input.metadata
  });
}

async function auditRegistrationRoleRequestDecision(
  tx: AuditTx,
  invocation: TrustedInvocationContext,
  input: {
    action: "approve" | "reject" | "enable-basic";
    requestId: string;
    userId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  await writeAuditEventInTx(tx, invocation, { requestId: context.requestId ?? randomUUID() }, {
    app: "user-governance",
    kind: "registration-role-request",
    action: input.action,
    severity: "High",
    projectId: null,
    targetType: "user",
    targetId: input.userId,
    metadata: { requestId: input.requestId, ...input.metadata }
  });
}

function normalizeOrganizationName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_FAILED", "Organization name is required.");
  }
  if (trimmed.length > organizationNameMaxLength) {
    throw new ApiError("VALIDATION_FAILED", `Organization name must be at most ${organizationNameMaxLength} characters.`, {
      maxLength: organizationNameMaxLength
    });
  }
  return trimmed;
}

export async function getHomeOrganization(db: Queryable, caller: GovernanceCaller) {
  const { auth, organizationId } = governanceScope(caller);
  if (!auth.user.isActive) {
    throw new ApiError("FORBIDDEN", "User is inactive.");
  }
  const organization = await getOrganizationById(db, organizationId);
  if (!organization) {
    throw new ApiError("NOT_FOUND", "Organization was not found.");
  }
  return organization;
}

export async function updateHomeOrganization(
  db: Database,
  caller: GovernanceCaller,
  input: UpdateOrganizationInput,
  context: AuditCorrelationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  const name = normalizeOrganizationName(input.name);

  return db.transaction(async (tx) => {
    const current = await getOrganizationById(tx, organizationId);
    if (!current) {
      throw new ApiError("NOT_FOUND", "Organization was not found.");
    }

    const organization = await updateOrganizationName(tx, organizationId, name);
    if (!organization) {
      throw new ApiError("NOT_FOUND", "Organization was not found.");
    }

    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: context.requestId ?? randomUUID() }, {
      app: "user-governance",
      kind: "organization-update",
      action: "update",
      severity: "High",
      projectId: null,
      targetType: "organization",
      targetId: organization.id,
      metadata: { previousName: current.name, name: organization.name }
    });

    return organization;
  });
}

export async function listGovernedUsers(db: Queryable, caller: GovernanceCaller) {
  const { auth, organizationId } = governanceScope(caller);
  requireUserManager(auth);
  return listUsers(db, organizationId);
}

export async function listGovernedProjectCandidates(db: Queryable, caller: GovernanceCaller) {
  const { auth, organizationId } = governanceScope(caller);
  requireOrgAdmin(auth);
  return (await db.query<{ id: string; name: string }>("select id, name from projects where organization_id=$1 order by name,id", [organizationId])).rows;
}

export async function getGovernedProjectMembers(db: Queryable, caller: GovernanceCaller, projectId: string) {
  const { auth, organizationId } = governanceScope(caller);
  requireOrgAdmin(auth);
  if (!await checkProjectBelongsToOrg(db, { organizationId, projectId })) {
    throw new ApiError("NOT_FOUND", "Project was not found.", { projectId });
  }
  return { projectId, members: await listProjectMembers(db, organizationId, projectId) };
}

export async function createUser(db: Database, caller: GovernanceCaller, input: CreateUserInput, context: AuditCorrelationContext = {}, configuredOidcIssuer?: string) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  if (input.roles.some((r) => r.projectId !== null && r.projectId !== undefined)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Account creation cannot include project-scoped role bindings. Assign project review roles from project management.",
      { code: "project-roles-not-allowed" }
    );
  }
  const roles = normalizeRoles(input.roles);
  // A new user starts with no roles; block granting platform-admin unless the caller holds it,
  // matching replaceUserRoles so user creation cannot be a platform-admin escalation path.
  assertPlatformAdminGrantAllowed(auth, [], roles);
  const name = input.name.trim();
  const oidc = "authentication" in input, username = oidc ? null : normalizeUsername(input.username);
  if (!oidc) { requireUsername(username!); requirePasswordPolicy(input.password); }
  if (oidc && !configuredOidcIssuer) throw new ApiError("VALIDATION_FAILED", "OIDC provisioning is not enabled.");
  if (!name) {
    throw new ApiError("VALIDATION_FAILED", "User name is required.");
  }

  return db.transaction(async (tx) => {
    const existingCredential = username ? await findPasswordCredentialByUsername(tx, username) : null;
    if (existingCredential) {
      throw new ApiError("CONFLICT", "Username is already registered.", { username });
    }

    const user = await insertUser(tx, {
      id: `u-${randomUUID()}`,
      organizationId,
      name,
      title: input.title?.trim() || "User",
      ...(oidc && input.email ? { email: input.email.trim().toLowerCase() } : {})
    });
    if (!oidc) await insertPasswordCredential(tx, {
      userId: user.id,
      username: username!,
      passwordHash: await hashPassword(input.password)
    });
    await updateOrganizationRoles(tx, {
      organizationId,
      userId: user.id,
      roles: roles.map((r) => r.roleId)
    });
    if (oidc) await setOidcIdentity(tx, invocation, user.id, { issuer: input.issuer,subject: input.subject,email: input.email,expectedIdentity: null }, configuredOidcIssuer, { requestId: context.requestId ?? randomUUID() });
    await auditUserMutation(asAuditTx(tx), invocation, {
      kind: "user-create",
      action: "create",
      userId: user.id,
      metadata: { username, roles }
    }, context);

    return oidc ? (await getUserById(tx, { organizationId,userId: user.id }))! : { ...user, username, roles };
  }).catch((error: unknown) => {
    if (oidc && (error as { code?: string })?.code === "23505") throw new ApiError("CONFLICT", "OIDC identity matches another member; check the subject and original migration email instead of merging accounts.");
    throw error;
  });
}

export async function updateUserProfile(
  db: Database,
  caller: GovernanceCaller,
  userId: string,
  input: UpdateUserProfileInput,
  context: AuditCorrelationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    const user = await updateUser(tx, {
      organizationId,
      userId,
      name: input.name?.trim(),
      email: input.email?.trim().toLowerCase(),
      title: input.title?.trim()
    });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    await auditUserMutation(asAuditTx(tx), invocation, {
      kind: "user-update",
      action: "update",
      userId,
      metadata: input
    }, context);

    return user;
  });
}

export async function resetUserPassword(
  db: Database,
  caller: GovernanceCaller,
  userId: string,
  input: ResetUserPasswordInput,
  context: AuditCorrelationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  requirePasswordPolicy(input.password);

  return db.transaction(async (tx) => {
    const current = await getUserById(tx, { organizationId, userId });
    if (!current) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    const updated = await updatePasswordCredential(tx, {
      userId,
      passwordHash: await hashPassword(input.password)
    });
    if (updated === 0) {
      throw new ApiError("NOT_FOUND", "Local password credential was not found.", { userId });
    }
    await revokeLocalUserSessions(tx, { userId, revokedAt: new Date().toISOString() });
    await auditUserMutation(asAuditTx(tx), invocation, {
      kind: "user-password-reset",
      action: "reset-password",
      userId,
      metadata: {}
    }, context);
    return current;
  });
}

export async function deactivateUser(
  db: Database,
  caller: GovernanceCaller,
  userId: string,
  input: UpdateUserActiveInput,
  context: AdministratorMutationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    await lockAdministratorMutation(tx);
    await lockUserById(tx, { organizationId, userId });
    const current = await getUserById(tx, { organizationId, userId });
    if (!current) throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    if (rolesIncludePlatformAdmin(current.roles) && !callerHasPlatformAdmin(auth)) throw new ApiError("FORBIDDEN", "Only a platform super admin may change platform-admin activation.");
    await assertAdministratorContinuity(tx, current, input, context);
    const user = await updateUserActive(tx, { organizationId, userId, isActive: input.isActive });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    await auditUserMutation(asAuditTx(tx), invocation, {
      kind: "user-activation",
      action: input.isActive ? "activate" : "deactivate",
      userId,
      metadata: { isActive: input.isActive }
    }, context);

    if (!input.isActive) {
      const adminUserIds = await listActiveAdminUserIds(tx, organizationId);
      await notifyUserDeactivated(tx, {
        organizationId,
        userId,
        actorName: auth.user.name,
        adminUserIds: adminUserIds.filter((id) => id !== userId)
      });
    }

    return user;
  });
}

export async function deleteUser(
  db: Database,
  caller: GovernanceCaller,
  userId: string,
  context: AdministratorMutationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  await db.transaction(async (tx) => {
    await lockAdministratorMutation(tx);
    const lockedUserId = await lockUserById(tx, { organizationId, userId });
    if (!lockedUserId) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    const user = await getUserById(tx, { organizationId, userId });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    if (rolesIncludePlatformAdmin(user.roles) && !callerHasPlatformAdmin(auth)) {
      throw new ApiError("FORBIDDEN", "Only a platform super admin may delete a platform-admin user.", {
        userId,
        roleId: "platform-admin"
      });
    }
    await assertAdministratorContinuity(tx, user, { isActive: false }, context);

    await auditUserMutation(asAuditTx(tx), invocation, {
      kind: "user-delete",
      action: "delete",
      userId,
      metadata: { isActive: user.isActive, roles: user.roles }
    }, context);
    const deletedRows = await deleteUserById(tx, {
      organizationId,
      userId,
      allowPlatformAdmin: callerHasPlatformAdmin(auth)
    });
    if (deletedRows !== 1) {
      const currentUser = await getUserById(tx, { organizationId, userId });
      if (currentUser && rolesIncludePlatformAdmin(currentUser.roles) && !callerHasPlatformAdmin(auth)) {
        throw new ApiError("FORBIDDEN", "Only a platform super admin may delete a platform-admin user.", {
          userId,
          roleId: "platform-admin"
        });
      }
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
  });
}

export async function replaceUserRoles(
  db: Database,
  caller: GovernanceCaller,
  userId: string,
  input: ReplaceUserRolesInput,
  context: AdministratorMutationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  if (input.roles.some((r) => r.projectId !== null && r.projectId !== undefined)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Project-scoped role replacements via /api/v1/users/:userId/roles are deprecated and unsupported. Use /api/v1/projects/:projectId/workflow-role-bindings/:userId instead.",
      { code: "project-roles-deprecated" }
    );
  }
  const roles = normalizeRoles(input.roles);

  return db.transaction(async (tx) => {
    await lockAdministratorMutation(tx);
    const lockedUserId = await lockUserById(tx, { organizationId, userId });
    if (!lockedUserId) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    const user = await getUserById(tx, { organizationId, userId });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    assertPlatformAdminGrantAllowed(auth, user.roles, roles);
    await assertAdministratorContinuity(tx, user, { roles }, context);
    const desiredOrgRoles = roles.map((r) => r.roleId);
    await updateOrganizationRoles(tx, {
      organizationId,
      userId,
      roles: desiredOrgRoles
    });
    await auditUserMutation(asAuditTx(tx), invocation, {
      kind: "user-role-replace",
      action: "replace-roles",
      userId,
      metadata: { roles }
    }, context);

    const adminUserIds = await listActiveAdminUserIds(tx, organizationId);
    await notifyUserRoleChanged(tx, {
      organizationId,
      userId,
      actorName: auth.user.name,
      roles,
      adminUserIds: adminUserIds.filter((id) => id !== userId)
    });

    const updated = await getUserById(tx, { organizationId, userId });
    return updated!;
  });
}

export async function listRegistrationRoleRequests(
  db: Queryable,
  caller: GovernanceCaller,
  status: RegistrationRoleRequestListStatus = "pending"
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  // Cross-organization visibility is a platform-admin capability; an org admin
  // only governs registrations inside their own tenant.
  return listRegistrationRoleRequestsByScope(db, {
    organizationId: callerHasPlatformAdmin(auth) && !invocation.operatingOrganization ? undefined : organizationId,
    status
  });
}

export function approveRegistrationRoleRequest(db: Database, caller: GovernanceCaller, requestId: string, context: AuditCorrelationContext = {}) {
  return decidePendingRegistration(db, caller, requestId, "approve", context);
}

export function enableBasicRegistrationRoleRequest(db: Database, caller: GovernanceCaller, requestId: string, context: AuditCorrelationContext = {}) {
  return decidePendingRegistration(db, caller, requestId, "enable-basic", context);
}

export function rejectRegistrationRoleRequest(db: Database, caller: GovernanceCaller, requestId: string, context: AuditCorrelationContext = {}) {
  return decidePendingRegistration(db, caller, requestId, "reject", context);
}

async function decidePendingRegistration(
  db: Database, caller: GovernanceCaller, requestId: string, decision: "approve" | "enable-basic" | "reject", context: AuditCorrelationContext
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireUserManager(auth);
  return db.transaction(async (tx) => {
    const readRequest = (lock = false) => callerHasPlatformAdmin(auth) && !invocation.operatingOrganization
      ? getPendingRegistrationRoleRequestByIdForAdmin(tx, requestId, lock)
      : getPendingRegistrationRoleRequestById(tx, { organizationId, requestId }, lock);
    const initial = await readRequest();
    if (!initial) throw new ApiError("NOT_FOUND", "Pending registration role request was not found.", { requestId });
    const scope = { organizationId: initial.organizationId, userId: initial.userId };
    // All three decisions share governance's user -> request order. Re-read only
    // after the user lock, including after waiting for a newer manual adjustment.
    if (!(await lockUserById(tx, scope))) throw new ApiError("NOT_FOUND", "User was not found.", { userId: scope.userId });
    const request = await readRequest(true);
    if (!request) throw new ApiError("CONFLICT", "Registration role request was already decided.", { requestId });
    const user = await getUserById(tx, scope);
    if (!user) throw new ApiError("NOT_FOUND", "User was not found.", { userId: scope.userId });
    const currentRoles = user.roles.filter(role => role.projectId === null && !role.roleId.startsWith("catalog-capability-")).map(role => role.roleId).sort();
    const stale = request.accountChanged || user.isActive || currentRoles.length !== 1 || currentRoles[0] !== request.currentRoleId;
    if (decision !== "reject" && stale) {
      throw new ApiError("CONFLICT", "Account settings changed after registration. Close this request to preserve the current account settings, then manage the member directly.", {
        code: "registration-account-changed", requestId, currentRoles, isActive: user.isActive
      });
    }
    const roles = decision === "reject" ? currentRoles : [decision === "approve" ? request.requestedRoleId : request.currentRoleId];
    const canLogin = decision === "reject" ? user.isActive : true;
    const outcome = decision === "approve" ? "requested-role-enabled" : decision === "enable-basic" ? "basic-enabled"
      : stale ? "rejected-preserved" : "rejected-disabled";
    if (decision !== "reject") {
      await updateOrganizationRoles(tx, { ...scope, roles });
      if (!(await updateUserActive(tx, { ...scope, isActive: true }))) throw new ApiError("NOT_FOUND", "User was not found.", { userId: scope.userId });
    }
    const decided = await decideRegistrationRoleRequest(tx, {
      organizationId: scope.organizationId, requestId, status: decision === "approve" ? "approved" : "rejected",
      decidedByUserId: auth.user.id, decidedAt: new Date().toISOString(), outcome, canLogin, roles
    });
    if (!decided) throw new ApiError("CONFLICT", "Registration role request was already decided.", { requestId });
    await auditRegistrationRoleRequestDecision(asAuditTx(tx), invocation, {
      action: decision, requestId, userId: request.userId,
      metadata: { username: request.username, currentRoleId: request.currentRoleId, requestedRoleId: request.requestedRoleId,
        outcome, canLogin, roles, organizationId: request.organizationId }
    }, context);
    await notifyRegistrationRoleDecided(tx, {
      ...scope, requestId, actorName: auth.user.name, outcome, canLogin, roles,
      adminUserIds: await listActiveAdminUserIds(tx, scope.organizationId)
    });
    return decided;
  });
}

export async function getProjectRoleBindings(
  db: Queryable,
  caller: GovernanceCaller,
  projectId: string
): Promise<ProjectWorkflowRoleBindingsDto> {
  const { auth, organizationId } = governanceScope(caller);
  requireOrgAdmin(auth);
  const belongs = await checkProjectBelongsToOrg(db, {
    organizationId,
    projectId
  });
  if (!belongs) {
    throw new ApiError("NOT_FOUND", "Project was not found.", { projectId });
  }

  const bindings = await getProjectWorkflowRoleBindings(db, {
    organizationId,
    projectId
  });

  const activeBindings = bindings.filter((b) => b.isActive);
  const hasHw = activeBindings.some((b) => b.roles.includes("hardware-committer"));
  const hasSwC = activeBindings.some((b) => b.roles.includes("software-committer"));
  const hasSwU = activeBindings.some((b) => b.roles.includes("software-user") || b.roles.includes("software-committer"));

  const missingRoles: ProjectWorkflowRoleId[] = [];
  if (!hasHw) missingRoles.push("hardware-committer");
  if (!hasSwC) missingRoles.push("software-committer");
  if (!hasSwU) missingRoles.push("software-user");

  return {
    projectId,
    ready: missingRoles.length === 0,
    missingRoles,
    bindings
  };
}

export async function replaceProjectWorkflowRoles(
  db: Database,
  caller: GovernanceCaller,
  projectId: string,
  userId: string,
  input: UpdateProjectWorkflowRoleBindingsInput,
  context: AuditCorrelationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireOrgAdmin(auth);
  const belongs = await checkProjectBelongsToOrg(db, {
    organizationId,
    projectId
  });
  if (!belongs) {
    throw new ApiError("NOT_FOUND", "Project was not found.", { projectId });
  }

  return db.transaction(async (tx) => {
    const lockedUserId = await lockUserById(tx, { organizationId, userId });
    if (!lockedUserId) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    const targetUser = await getUserById(tx, { organizationId, userId });
    if (!targetUser) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }

    const currentRoles = await getUserProjectWorkflowRoles(tx, {
      organizationId,
      projectId,
      userId
    });
    const sortedCurrent = [...currentRoles].sort();
    const sortedExpected = [...new Set(input.expectedRoles)].sort();
    const sortedDesired = [...new Set(input.roles)].sort();

    if (!targetUser.isActive) {
      const hasNewGrants = sortedDesired.some((r) => !sortedCurrent.includes(r));
      if (hasNewGrants) {
        throw new ApiError("VALIDATION_FAILED", "Cannot assign new project roles to an inactive user.", {
          code: "target-user-inactive",
          userId
        });
      }
    }

    if (arraysEqual(sortedCurrent, sortedDesired)) {
      return { projectId, userId, roles: sortedDesired };
    }

    if (!arraysEqual(sortedCurrent, sortedExpected)) {
      throw new ApiError("CONFLICT", "Project workflow roles are stale.", {
        code: "role-bindings-stale",
        currentRoles: sortedCurrent,
        expectedRoles: sortedExpected
      });
    }

    await updateProjectWorkflowRoles(tx, {
      organizationId,
      projectId,
      userId,
      roles: sortedDesired
    });

    await writeAuditEventInTx(
      asAuditTx(tx),
      invocation,
      { requestId: context.requestId ?? randomUUID() },
      {
        app: "user-governance",
        kind: "project-role-update",
        action: "update-roles",
        severity: "Medium",
        projectId,
        targetType: "project",
        targetId: projectId,
        metadata: {
          userId,
          targetUserName: targetUser.name,
          previousRoles: sortedCurrent,
          roles: sortedDesired
        }
      }
    );

    return { projectId, userId, roles: sortedDesired };
  });
}

export async function replaceOrganizationRoles(
  db: Database,
  caller: GovernanceCaller,
  userId: string,
  input: UpdateOrganizationRolesInput,
  context: AdministratorMutationContext = {}
) {
  const { auth, organizationId, invocation } = governanceScope(caller);
  requireOrgAdmin(auth);

  return db.transaction(async (tx) => {
    await lockAdministratorMutation(tx);
    const lockedUserId = await lockUserById(tx, { organizationId, userId });
    if (!lockedUserId) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    const targetUser = await getUserById(tx, { organizationId, userId });
    if (!targetUser) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }

    const sortedDesired = [...new Set(input.roles)].sort();
    const sortedExpected = [...new Set(input.expectedRoles)].sort();

    assertPlatformAdminGrantAllowed(
      auth,
      targetUser.roles.filter((r) => r.projectId === null),
      sortedDesired.map((roleId) => ({ projectId: null, roleId }))
    );

    const currentRoles = await getUserOrganizationRoles(tx, {
      organizationId,
      userId
    });
    const sortedCurrent = [...currentRoles].sort();

    if (arraysEqual(sortedCurrent, sortedDesired)) {
      return targetUser;
    }

    if (!arraysEqual(sortedCurrent, sortedExpected)) {
      throw new ApiError("CONFLICT", "Organization roles are stale.", {
        code: "role-bindings-stale",
        currentRoles: sortedCurrent,
        expectedRoles: sortedExpected
      });
    }
    await assertAdministratorContinuity(tx, targetUser, { roles: sortedDesired.map((roleId) => ({ projectId: null, roleId })) }, context);

    await updateOrganizationRoles(tx, {
      organizationId,
      userId,
      roles: sortedDesired
    });

    await auditUserMutation(
      asAuditTx(tx),
      invocation,
      {
        kind: "user-role-replace",
        action: "replace-roles",
        userId,
        metadata: { previousRoles: sortedCurrent, roles: sortedDesired }
      },
      context
    );

    const adminUserIds = await listActiveAdminUserIds(tx, organizationId);
    await notifyUserRoleChanged(tx, {
      organizationId,
      userId,
      actorName: auth.user.name,
      roles: sortedDesired.map((r) => ({ projectId: null, roleId: r })),
      adminUserIds: adminUserIds.filter((id) => id !== userId)
    });

    const updated = await getUserById(tx, { organizationId, userId });
    return updated!;
  });
}
