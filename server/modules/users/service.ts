import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext, BackendRoleId, RoleBinding } from "../auth/types";
import {
  countActiveAdmins,
  decideRegistrationRoleRequest,
  getPendingRegistrationRoleRequestByIdForAdmin,
  getPendingRegistrationRoleRequestById,
  getUserById,
  findPasswordCredentialByUsername,
  listActiveAdminUserIds,
  listAllPendingRegistrationRoleRequests,
  insertUser,
  insertPasswordCredential,
  listPendingRegistrationRoleRequests,
  listUsers,
  replaceRoleBindings,
  updateUser,
  updateUserActive
} from "./repository";
import { notifyUserDeactivated, notifyUserRoleChanged } from "../notifications/producers";
import type { CreateUserInput, ReplaceUserRolesInput, UpdateUserActiveInput, UpdateUserProfileInput } from "./types";

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

function requireUserManager(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("users:manage")) {
    throw new ApiError("FORBIDDEN", "User management permission is required.", { permission: "users:manage" });
  }
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

function hasAdminRole(roles: RoleBinding[]) {
  return roles.some((role) => role.roleId === "admin" || role.roleId === "platform-admin");
}

function callerHasPlatformAdmin(auth: AuthContext) {
  return auth.roles.some((role) => role.roleId === "platform-admin");
}

function rolesIncludePlatformAdmin(roles: RoleBinding[]) {
  return roles.some((role) => role.roleId === "platform-admin");
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

async function assertNoSelfLockout(
  tx: Queryable,
  auth: AuthContext,
  userId: string,
  next: { isActive?: boolean; roles?: RoleBinding[] }
) {
  if (userId !== auth.user.id) return;

  if (next.isActive === false) {
    throw new ApiError("CONFLICT", "Active Admin cannot disable itself.", { userId });
  }

  if (next.roles && !hasAdminRole(next.roles)) {
    throw new ApiError("CONFLICT", "Active Admin cannot remove its last Admin capability.", { userId });
  }

  if (next.roles && hasAdminRole(auth.roles) && !hasAdminRole(next.roles)) {
    const activeAdmins = await countActiveAdmins(tx, auth.organization.id);
    if (activeAdmins <= 1) {
      throw new ApiError("CONFLICT", "Active Admin cannot remove its last Admin capability.", { userId });
    }
  }
}

async function auditUserMutation(
  tx: AuditTx,
  auth: AuthContext,
  input: {
    kind: "user-create" | "user-update" | "user-activation" | "user-role-replace";
    action: "create" | "update" | "activate" | "deactivate" | "replace-roles";
    userId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  // requestId fallback survives only until user-governance contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
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
  auth: AuthContext,
  input: {
    action: "approve" | "reject";
    requestId: string;
    userId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
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

export async function listGovernedUsers(db: Queryable, auth: AuthContext) {
  requireUserManager(auth);
  return listUsers(db, auth.organization.id);
}

export async function createUser(db: Database, auth: AuthContext, input: CreateUserInput, context: AuditCorrelationContext = {}) {
  requireUserManager(auth);
  const roles = normalizeRoles(input.roles);
  // A new user starts with no roles; block granting platform-admin unless the caller holds it,
  // matching replaceUserRoles so user creation cannot be a platform-admin escalation path.
  assertPlatformAdminGrantAllowed(auth, [], roles);
  const name = input.name.trim();
  const username = normalizeUsername(input.username);
  requireUsername(username);
  requirePasswordPolicy(input.password);
  if (!name) {
    throw new ApiError("VALIDATION_FAILED", "User name is required.");
  }

  return db.transaction(async (tx) => {
    const existingCredential = await findPasswordCredentialByUsername(tx, username);
    if (existingCredential) {
      throw new ApiError("CONFLICT", "Username is already registered.", { username });
    }

    const user = await insertUser(tx, {
      id: `u-${randomUUID()}`,
      organizationId: auth.organization.id,
      name,
      title: input.title?.trim() || "User"
    });
    await insertPasswordCredential(tx, {
      userId: user.id,
      username,
      passwordHash: await hashPassword(input.password)
    });
    await replaceRoleBindings(tx, { organizationId: auth.organization.id, userId: user.id, roles });
    await auditUserMutation(asAuditTx(tx), auth, {
      kind: "user-create",
      action: "create",
      userId: user.id,
      metadata: { username, roles }
    }, context);

    return { ...user, username, roles };
  });
}

export async function updateUserProfile(
  db: Database,
  auth: AuthContext,
  userId: string,
  input: UpdateUserProfileInput,
  context: AuditCorrelationContext = {}
) {
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    const user = await updateUser(tx, {
      organizationId: auth.organization.id,
      userId,
      name: input.name?.trim(),
      email: input.email?.trim().toLowerCase(),
      title: input.title?.trim()
    });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    await auditUserMutation(asAuditTx(tx), auth, {
      kind: "user-update",
      action: "update",
      userId,
      metadata: input
    }, context);

    return user;
  });
}

export async function deactivateUser(
  db: Database,
  auth: AuthContext,
  userId: string,
  input: UpdateUserActiveInput,
  context: AuditCorrelationContext = {}
) {
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    await assertNoSelfLockout(tx, auth, userId, { isActive: input.isActive });
    const user = await updateUserActive(tx, { organizationId: auth.organization.id, userId, isActive: input.isActive });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    await auditUserMutation(asAuditTx(tx), auth, {
      kind: "user-activation",
      action: input.isActive ? "activate" : "deactivate",
      userId,
      metadata: { isActive: input.isActive }
    }, context);

    if (!input.isActive) {
      const adminUserIds = await listActiveAdminUserIds(tx, auth.organization.id);
      await notifyUserDeactivated(tx, {
        organizationId: auth.organization.id,
        userId,
        actorName: auth.user.name,
        adminUserIds: adminUserIds.filter((id) => id !== userId)
      });
    }

    return user;
  });
}

export async function replaceUserRoles(
  db: Database,
  auth: AuthContext,
  userId: string,
  input: ReplaceUserRolesInput,
  context: AuditCorrelationContext = {}
) {
  requireUserManager(auth);
  const roles = normalizeRoles(input.roles);

  return db.transaction(async (tx) => {
    await assertNoSelfLockout(tx, auth, userId, { roles });
    const user = await getUserById(tx, { organizationId: auth.organization.id, userId });
    if (!user) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId });
    }
    assertPlatformAdminGrantAllowed(auth, user.roles, roles);
    await replaceRoleBindings(tx, { organizationId: auth.organization.id, userId, roles });
    await auditUserMutation(asAuditTx(tx), auth, {
      kind: "user-role-replace",
      action: "replace-roles",
      userId,
      metadata: { roles }
    }, context);

    const adminUserIds = await listActiveAdminUserIds(tx, auth.organization.id);
    await notifyUserRoleChanged(tx, {
      organizationId: auth.organization.id,
      userId,
      actorName: auth.user.name,
      roles,
      adminUserIds: adminUserIds.filter((id) => id !== userId)
    });

    return { ...user, roles };
  });
}

export async function listRegistrationRoleRequests(db: Queryable, auth: AuthContext) {
  requireUserManager(auth);
  // Cross-organization visibility is a platform-admin capability; an org admin
  // only governs registrations inside their own tenant.
  return callerHasPlatformAdmin(auth)
    ? listAllPendingRegistrationRoleRequests(db)
    : listPendingRegistrationRoleRequests(db, auth.organization.id);
}

export async function approveRegistrationRoleRequest(
  db: Database,
  auth: AuthContext,
  requestId: string,
  context: AuditCorrelationContext = {}
) {
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    const request = callerHasPlatformAdmin(auth)
      ? await getPendingRegistrationRoleRequestByIdForAdmin(tx, requestId)
      : await getPendingRegistrationRoleRequestById(tx, { organizationId: auth.organization.id, requestId });
    if (!request) {
      throw new ApiError("NOT_FOUND", "Pending registration role request was not found.", { requestId });
    }

    if (!(await getUserById(tx, { organizationId: request.organizationId, userId: request.userId }))) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId: request.userId });
    }

    await replaceRoleBindings(tx, {
      organizationId: request.organizationId,
      userId: request.userId,
      roles: [{ projectId: null, roleId: request.requestedRoleId }]
    });
    const activated = await updateUserActive(tx, { organizationId: request.organizationId, userId: request.userId, isActive: true });
    if (!activated) {
      throw new ApiError("NOT_FOUND", "User was not found.", { userId: request.userId });
    }
    const decided = await decideRegistrationRoleRequest(tx, {
      organizationId: request.organizationId,
      requestId,
      status: "approved",
      decidedByUserId: auth.user.id,
      decidedAt: new Date().toISOString()
    });
    if (!decided) {
      throw new ApiError("CONFLICT", "Registration role request was already decided.", { requestId });
    }
    await auditRegistrationRoleRequestDecision(asAuditTx(tx), auth, {
      action: "approve",
      requestId,
      userId: request.userId,
      metadata: {
        username: request.username,
        previousRoleId: request.currentRoleId,
        requestedRoleId: request.requestedRoleId
      }
    }, context);

    const adminUserIds = await listActiveAdminUserIds(tx, request.organizationId);
    await notifyUserRoleChanged(tx, {
      organizationId: request.organizationId,
      userId: request.userId,
      actorName: auth.user.name,
      roles: [{ projectId: null, roleId: request.requestedRoleId }],
      adminUserIds: adminUserIds.filter((id) => id !== request.userId)
    });

    return decided;
  });
}

export async function rejectRegistrationRoleRequest(
  db: Database,
  auth: AuthContext,
  requestId: string,
  context: AuditCorrelationContext = {}
) {
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    const request = callerHasPlatformAdmin(auth)
      ? await getPendingRegistrationRoleRequestByIdForAdmin(tx, requestId)
      : await getPendingRegistrationRoleRequestById(tx, { organizationId: auth.organization.id, requestId });
    if (!request) {
      throw new ApiError("NOT_FOUND", "Pending registration role request was not found.", { requestId });
    }

    const decided = await decideRegistrationRoleRequest(tx, {
      organizationId: request.organizationId,
      requestId,
      status: "rejected",
      decidedByUserId: auth.user.id,
      decidedAt: new Date().toISOString()
    });
    if (!decided) {
      throw new ApiError("CONFLICT", "Registration role request was already decided.", { requestId });
    }
    await auditRegistrationRoleRequestDecision(asAuditTx(tx), auth, {
      action: "reject",
      requestId,
      userId: request.userId,
      metadata: {
        username: request.username,
        currentRoleId: request.currentRoleId,
        requestedRoleId: request.requestedRoleId
      }
    }, context);

    return decided;
  });
}
