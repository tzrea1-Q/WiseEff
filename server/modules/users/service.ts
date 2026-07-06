import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createAuditEvent } from "../audit/repository";
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

const roleIds = new Set<BackendRoleId>(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"]);
const scryptAsync = promisify(scrypt);
const passwordHashPrefix = "scrypt";

function requireUserManager(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("users:manage")) {
    throw new ApiError("FORBIDDEN", "User management permission is required.", 403, { permission: "users:manage" });
  }
}

function normalizeRoles(roles: ReplaceUserRolesInput["roles"]): RoleBinding[] {
  return roles.map((role) => {
    if (!roleIds.has(role.roleId)) {
      throw new ApiError("VALIDATION_FAILED", "Role id is not supported.", 400, { roleId: role.roleId });
    }

    return { projectId: role.projectId ?? null, roleId: role.roleId };
  });
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function requireUsername(username: string) {
  if (!username) {
    throw new ApiError("VALIDATION_FAILED", "Username is required.", 400);
  }
  if (username.length < 3 || username.length > 64) {
    throw new ApiError("VALIDATION_FAILED", "Username must be 3 to 64 characters.", 400);
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new ApiError("VALIDATION_FAILED", "Username can only contain letters, numbers, dots, underscores, or hyphens.", 400);
  }
}

function requirePasswordPolicy(password: string) {
  if (password.length < 8) {
    throw new ApiError("VALIDATION_FAILED", "Password must be at least 8 characters.", 400);
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${passwordHashPrefix}$${salt}$${derived.toString("base64url")}`;
}

function hasAdminRole(roles: RoleBinding[]) {
  return roles.some((role) => role.roleId === "admin");
}

async function assertNoSelfLockout(
  tx: Queryable,
  auth: AuthContext,
  userId: string,
  next: { isActive?: boolean; roles?: RoleBinding[] }
) {
  if (userId !== auth.user.id) return;

  if (next.isActive === false) {
    throw new ApiError("CONFLICT", "Active Admin cannot disable itself.", 409, { userId });
  }

  if (next.roles && !hasAdminRole(next.roles)) {
    throw new ApiError("CONFLICT", "Active Admin cannot remove its last Admin capability.", 409, { userId });
  }

  if (next.roles && hasAdminRole(auth.roles) && !hasAdminRole(next.roles)) {
    const activeAdmins = await countActiveAdmins(tx, auth.organization.id);
    if (activeAdmins <= 1) {
      throw new ApiError("CONFLICT", "Active Admin cannot remove its last Admin capability.", 409, { userId });
    }
  }
}

async function auditUserMutation(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: "user-create" | "user-update" | "user-activation" | "user-role-replace";
    action: "create" | "update" | "activate" | "deactivate" | "replace-roles";
    userId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "user-governance",
    kind: input.kind,
    action: input.action,
    severity: "High",
    targetType: "user",
    targetId: input.userId,
    metadata: input.metadata,
    traceId: context.requestId ?? randomUUID()
  });
}

async function auditRegistrationRoleRequestDecision(
  db: Queryable,
  auth: AuthContext,
  input: {
    action: "approve" | "reject";
    requestId: string;
    userId: string;
    metadata: Record<string, unknown>;
  },
  context: AuditCorrelationContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "user-governance",
    kind: "registration-role-request",
    action: input.action,
    severity: "High",
    targetType: "user",
    targetId: input.userId,
    metadata: { requestId: input.requestId, ...input.metadata },
    traceId: context.requestId ?? randomUUID()
  });
}

export async function listGovernedUsers(db: Queryable, auth: AuthContext) {
  requireUserManager(auth);
  return listUsers(db, auth.organization.id);
}

export async function createUser(db: Database, auth: AuthContext, input: CreateUserInput, context: AuditCorrelationContext = {}) {
  requireUserManager(auth);
  const roles = normalizeRoles(input.roles);
  const name = input.name.trim();
  const username = normalizeUsername(input.username);
  requireUsername(username);
  requirePasswordPolicy(input.password);
  if (!name) {
    throw new ApiError("VALIDATION_FAILED", "User name is required.", 400);
  }

  return db.transaction(async (tx) => {
    const existingCredential = await findPasswordCredentialByUsername(tx, username);
    if (existingCredential) {
      throw new ApiError("CONFLICT", "Username is already registered.", 409, { username });
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
    await auditUserMutation(tx, auth, {
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
      throw new ApiError("NOT_FOUND", "User was not found.", 404, { userId });
    }
    await auditUserMutation(tx, auth, {
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
      throw new ApiError("NOT_FOUND", "User was not found.", 404, { userId });
    }
    await auditUserMutation(tx, auth, {
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
      throw new ApiError("NOT_FOUND", "User was not found.", 404, { userId });
    }
    await replaceRoleBindings(tx, { organizationId: auth.organization.id, userId, roles });
    await auditUserMutation(tx, auth, {
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
  return hasAdminRole(auth.roles) ? listAllPendingRegistrationRoleRequests(db) : listPendingRegistrationRoleRequests(db, auth.organization.id);
}

export async function approveRegistrationRoleRequest(
  db: Database,
  auth: AuthContext,
  requestId: string,
  context: AuditCorrelationContext = {}
) {
  requireUserManager(auth);

  return db.transaction(async (tx) => {
    const request = hasAdminRole(auth.roles)
      ? await getPendingRegistrationRoleRequestByIdForAdmin(tx, requestId)
      : await getPendingRegistrationRoleRequestById(tx, { organizationId: auth.organization.id, requestId });
    if (!request) {
      throw new ApiError("NOT_FOUND", "Pending registration role request was not found.", 404, { requestId });
    }

    if (!(await getUserById(tx, { organizationId: request.organizationId, userId: request.userId }))) {
      throw new ApiError("NOT_FOUND", "User was not found.", 404, { userId: request.userId });
    }

    await replaceRoleBindings(tx, {
      organizationId: request.organizationId,
      userId: request.userId,
      roles: [{ projectId: null, roleId: request.requestedRoleId }]
    });
    const activated = await updateUserActive(tx, { organizationId: request.organizationId, userId: request.userId, isActive: true });
    if (!activated) {
      throw new ApiError("NOT_FOUND", "User was not found.", 404, { userId: request.userId });
    }
    const decided = await decideRegistrationRoleRequest(tx, {
      organizationId: request.organizationId,
      requestId,
      status: "approved",
      decidedByUserId: auth.user.id,
      decidedAt: new Date().toISOString()
    });
    if (!decided) {
      throw new ApiError("CONFLICT", "Registration role request was already decided.", 409, { requestId });
    }
    await auditRegistrationRoleRequestDecision(tx, auth, {
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
    const request = hasAdminRole(auth.roles)
      ? await getPendingRegistrationRoleRequestByIdForAdmin(tx, requestId)
      : await getPendingRegistrationRoleRequestById(tx, { organizationId: auth.organization.id, requestId });
    if (!request) {
      throw new ApiError("NOT_FOUND", "Pending registration role request was not found.", 404, { requestId });
    }

    const decided = await decideRegistrationRoleRequest(tx, {
      organizationId: request.organizationId,
      requestId,
      status: "rejected",
      decidedByUserId: auth.user.id,
      decidedAt: new Date().toISOString()
    });
    if (!decided) {
      throw new ApiError("CONFLICT", "Registration role request was already decided.", 409, { requestId });
    }
    await auditRegistrationRoleRequestDecision(tx, auth, {
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
