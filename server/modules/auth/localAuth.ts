import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createAuditEvent } from "../audit/repository";
import { getAuthContext } from "./repository";
import { countLocalAdminBindings } from "./bootstrapLocalAdmin";
import { authAttemptKey, createAuthAttemptLimiter, type AuthAttemptLimiter } from "./authAttemptLimiter";
import { resolveEvaluationOrganization, type ResolvedOrganization } from "./evaluationOrganization";
import {
  hashLocalAccountPassword,
  hashLocalSessionToken,
  validateLocalAccountPassword,
  validateLocalAccountUsername
} from "./localAccountCredentials";
import type { AuthContext, BackendRoleId } from "./types";

const scryptAsync = promisify(scrypt);
const passwordHashPrefix = "scrypt";
const defaultSessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const roleIds = new Set<BackendRoleId>([
  "guest",
  "hardware-user",
  "software-user",
  "hardware-committer",
  "software-committer",
  "admin",
  "platform-admin"
]);
const approvalRequiredRoleIds = new Set<BackendRoleId>(["hardware-committer", "software-committer"]);
const defaultSelfRegistrationRoleId: BackendRoleId = "hardware-user";

type UserLookupRow = {
  id: string;
  organization_id: string;
  name: string;
  title: string;
  is_active: boolean;
  username: string | null;
  password_hash: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  organization_id: string;
  expires_at: string;
  revoked_at: string | null;
};

export type LocalAuthPublicConfig = {
  provider: "local";
  selfRegisterEnabled: boolean;
  hasLocalAdmin: boolean;
  evaluationOrganizationName: string | null;
};

export type LocalAuthServiceOptions = {
  now?: () => Date;
  sessionTtlMs?: number;
  selfRegisterEnabled?: boolean;
  attemptLimiter?: AuthAttemptLimiter;
  registrationOrganizationResolver?: (db: Queryable) => ResolvedOrganization | Promise<ResolvedOrganization>;
};

export type RegisterLocalAccountInput = {
  organization?: string;
  organizationName?: string;
  name: string;
  username: string;
  title?: string;
  roleId?: BackendRoleId;
  password: string;
};

export type LocalAuthSessionResult = {
  status: "authenticated";
  auth: AuthContext;
  session: {
    token: string;
    expiresAt: string;
  };
};

export type PendingLocalRegistrationResult = {
  status: "pending_approval";
  user: {
    id: string;
    organizationId: string;
    name: string;
    username: string;
    title: string;
    isActive: false;
  };
  organization: {
    id: string;
    name: string;
  };
  requestedRoleId: BackendRoleId;
  assignedRoleId: BackendRoleId;
};

export type RegisterLocalAccountResult = LocalAuthSessionResult | PendingLocalRegistrationResult;

export type LoginLocalAccountInput = {
  username: string;
  password: string;
};

export type UpdateCurrentUserProfileInput = {
  name?: string;
  title?: string;
};

export type ChangeLocalAccountPasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export type AuthAttemptContext = {
  requestId: string;
  clientIp?: string;
};

export { resolveEvaluationOrganization } from "./evaluationOrganization";

function bearerToken(authorization: string | string[] | undefined) {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) {
    throw new ApiError("UNAUTHENTICATED", "Authorization bearer token is required.");
  }
  return match[1];
}

function optionalBearerToken(authorization: string | string[] | undefined) {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match ? match[1] : undefined;
}

function assignedRoleForRegistration(roleId: BackendRoleId): BackendRoleId {
  if (roleId === "admin" || roleId === "platform-admin") {
    throw new ApiError("VALIDATION_FAILED", "Admin registration is not allowed.", { roleId });
  }

  if (roleId === "hardware-committer") {
    return "hardware-user";
  }

  if (roleId === "software-committer") {
    return "software-user";
  }

  return roleId;
}

export function isLocalSessionToken(token: string) {
  return /^we_local_[A-Za-z0-9_-]{32,}$/.test(token);
}

export async function revokeLocalUserSessions(
  db: Queryable,
  input: { userId: string; exceptTokenHash?: string; revokedAt: string }
) {
  await db.query(
    `
    update auth_sessions
    set revoked_at = $2
    where user_id = $1
      and revoked_at is null
      and ($3::text is null or token_hash <> $3)
    `,
    [input.userId, input.revokedAt, input.exceptTokenHash ?? null]
  );
}

export async function updateLocalAccountPasswordHash(db: Queryable, input: { userId: string; passwordHash: string }) {
  await db.query(
    `
    update user_password_credentials
    set password_hash = $2, password_updated_at = now()
    where user_id = $1
    `,
    [input.userId, input.passwordHash]
  );
}

function hashToken(token: string) {
  return hashLocalSessionToken(token);
}

async function hashPassword(password: string) {
  return hashLocalAccountPassword(password);
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function requireUsername(username: string) {
  validateLocalAccountUsername(username);
}

function requirePasswordPolicy(password: string) {
  validateLocalAccountPassword(password);
}

async function verifyPassword(password: string, passwordHash: string) {
  const [scheme, salt, expectedHash] = passwordHash.split("$");
  if (scheme !== passwordHashPrefix || !salt || !expectedHash) {
    throw new ApiError("UNAUTHENTICATED", "Username or password is incorrect.");
  }

  const expected = Buffer.from(expectedHash, "base64url");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Stays on the direct path (ratchet allowlist): register/login/logout audits fire
// before an AuthContext exists, and the audited-write seam derives actor/org from
// auth. Every call site is already inside its operation's transaction.
async function auditAuthEvent(
  db: Queryable,
  input: {
    organizationId: string;
    userId: string | null;
    action: "register" | "login" | "login-failed" | "logout" | "update-profile" | "change-password";
    metadata?: Record<string, unknown>;
    traceId: string;
  }
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: input.organizationId,
    projectId: null,
    actorUserId: input.userId,
    actorType: "user",
    app: "auth",
    kind: "auth-event",
    action: input.action,
    severity: input.action === "logout" ? "Low" : input.action === "login-failed" ? "Low" : "Medium",
    targetType: "user",
    targetId: input.userId,
    metadata: input.metadata ?? {},
    traceId: input.traceId
  });
}

async function createSession(db: Queryable, input: { userId: string; organizationId: string; now: Date; ttlMs: number }) {
  const token = `we_local_${randomBytes(32).toString("base64url")}`;
  const sessionId = `sess-${randomUUID()}`;
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);

  await db.query(
    `
    insert into auth_sessions (id, user_id, organization_id, token_hash, expires_at)
    values ($1, $2, $3, $4, $5)
    `,
    [sessionId, input.userId, input.organizationId, hashToken(token), expiresAt.toISOString()]
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

async function findUserForLogin(db: Queryable, username: string) {
  const result = await db.query<UserLookupRow>(
    `
    select
      users.id,
      users.organization_id,
      users.name,
      users.title,
      users.is_active,
      user_password_credentials.username,
      user_password_credentials.password_hash
    from users
    join user_password_credentials on user_password_credentials.user_id = users.id
    where lower(user_password_credentials.username) = lower($1)
    limit 1
    `,
    [username]
  );

  return result.rows[0] ?? null;
}

async function findUserForPasswordChange(db: Queryable, userId: string) {
  const result = await db.query<UserLookupRow>(
    `
    select
      users.id,
      users.organization_id,
      users.name,
      users.title,
      users.is_active,
      user_password_credentials.username,
      user_password_credentials.password_hash
    from users
    join user_password_credentials on user_password_credentials.user_id = users.id
    where users.id = $1
    limit 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function hasPendingRegistrationRoleRequest(db: Queryable, userId: string) {
  const result = await db.query<{ exists: boolean }>(
    `
    select true as exists
    from local_registration_role_requests
    where user_id = $1
      and status = 'pending'
    limit 1
    `,
    [userId]
  );

  return result.rows.length > 0;
}

export function createLocalAuthService(db: Database, options: LocalAuthServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? defaultSessionTtlMs;
  const selfRegisterEnabled = options.selfRegisterEnabled ?? true;
  const attemptLimiter = options.attemptLimiter ?? createAuthAttemptLimiter();
  const resolveRegistrationOrganization =
    options.registrationOrganizationResolver ?? resolveEvaluationOrganization;

  function consumeAttempt(kind: "login" | "register", username: string, clientIp?: string) {
    const key = authAttemptKey(kind, clientIp ?? "unknown", username);
    const decision = attemptLimiter.consume(key);
    if (!decision.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many authentication attempts. Try again later.", {
        retryAfterMs: decision.retryAfterMs
      });
    }
    return key;
  }

  return {
    async getPublicConfig(): Promise<LocalAuthPublicConfig> {
      const adminCount = await countLocalAdminBindings(db);
      let evaluationOrganizationName: string | null = null;
      try {
        evaluationOrganizationName = (await resolveRegistrationOrganization(db)).name;
      } catch {
        evaluationOrganizationName = null;
      }
      return {
        provider: "local",
        selfRegisterEnabled,
        hasLocalAdmin: adminCount > 0,
        evaluationOrganizationName
      };
    },

    async register(input: RegisterLocalAccountInput, context: AuthAttemptContext) {
      if (!selfRegisterEnabled) {
        throw new ApiError("FORBIDDEN", "Self-registration is disabled.");
      }
      const username = normalizeUsername(input.username);
      requireUsername(username);
      consumeAttempt("register", username, context.clientIp);
      const name = input.name.trim();
      const requestedRoleId = input.roleId ?? defaultSelfRegistrationRoleId;
      const roleId = assignedRoleForRegistration(requestedRoleId);
      const title = input.title?.trim() || roleId;
      const approvalRequired = approvalRequiredRoleIds.has(requestedRoleId);
      requirePasswordPolicy(input.password);
      if (!name) {
        throw new ApiError("VALIDATION_FAILED", "User name is required.");
      }
      if (!roleIds.has(requestedRoleId)) {
        throw new ApiError("VALIDATION_FAILED", "Role is not supported.", { roleId: requestedRoleId });
      }

      return db.transaction(async (tx) => {
        const existing = await tx.query<{ id: string }>(
          `
          select user_id as id
          from user_password_credentials
          where lower(username) = lower($1)
          limit 1
          `,
          [username]
        );
        if (existing.rows.length > 0) {
          throw new ApiError("CONFLICT", "Username is already registered.", { username });
        }

        const registrationOrganization = await resolveRegistrationOrganization(tx);
        const organizationId = registrationOrganization.id;
        const userId = `u-${randomUUID()}`;
        await tx.query(
          `
          insert into users (id, organization_id, name, title, is_active, last_active_at)
          values ($1, $2, $3, $4, $5, $6)
          `,
          [userId, organizationId, name, title, !approvalRequired, approvalRequired ? null : now().toISOString()]
        );
        await tx.query("insert into user_password_credentials (user_id, username, password_hash) values ($1, $2, $3)", [
          userId,
          username,
          await hashPassword(input.password)
        ]);
        await tx.query(
          `
          insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
          values ($1, $2, $3, null, $4)
          `,
          [randomUUID(), userId, organizationId, roleId]
        );
        if (approvalRequired) {
          await tx.query(
            `
            insert into local_registration_role_requests (
              id,
              organization_id,
              user_id,
              current_role_id,
              requested_role_id
            )
            values ($1, $2, $3, $4, $5)
            `,
            [`registration-role-request-${randomUUID()}`, organizationId, userId, roleId, requestedRoleId]
          );
        }
        await auditAuthEvent(tx, {
          organizationId,
          userId,
          action: "register",
          metadata: {
            username,
            roleId,
            requestedRoleId,
            organization: registrationOrganization.name,
            approvalRequired
          },
          traceId: context.requestId
        });

        if (approvalRequired) {
          return {
            status: "pending_approval",
            user: {
              id: userId,
              organizationId,
              name,
              username,
              title,
              isActive: false
            },
            organization: registrationOrganization,
            requestedRoleId,
            assignedRoleId: roleId
          } satisfies PendingLocalRegistrationResult;
        }

        const session = await createSession(tx, { userId, organizationId, now: now(), ttlMs: sessionTtlMs });
        return { status: "authenticated", auth: await getAuthContext(tx, userId), session } satisfies LocalAuthSessionResult;
      });
    },

    async login(input: LoginLocalAccountInput, context: AuthAttemptContext) {
      const username = normalizeUsername(input.username);
      requireUsername(username);
      const attemptKey = consumeAttempt("login", username, context.clientIp);
      const user = await findUserForLogin(db, username);
      if (!user || !user.password_hash || !(await verifyPassword(input.password, user.password_hash))) {
        const organizationId = user?.organization_id ?? (await resolveRegistrationOrganization(db).catch(() => null))?.id;
        if (organizationId) {
          await auditAuthEvent(db, {
            organizationId,
            userId: user?.id ?? null,
            action: "login-failed",
            metadata: { username, reason: user ? "invalid_password" : "unknown_username" },
            traceId: context.requestId
          });
        }
        throw new ApiError("UNAUTHENTICATED", "Username or password is incorrect.");
      }
      if (!user.is_active) {
        const pending = await hasPendingRegistrationRoleRequest(db, user.id);
        await auditAuthEvent(db, {
          organizationId: user.organization_id,
          userId: user.id,
          action: "login-failed",
          metadata: { username, reason: pending ? "pending_approval" : "inactive" },
          traceId: context.requestId
        });
        if (pending) {
          throw new ApiError("FORBIDDEN", "User is pending Admin approval.");
        }
        throw new ApiError("FORBIDDEN", "User is inactive.");
      }

      return db.transaction(async (tx) => {
        await tx.query("update users set last_active_at = $3 where organization_id = $1 and id = $2", [
          user.organization_id,
          user.id,
          now().toISOString()
        ]);
        const session = await createSession(tx, { userId: user.id, organizationId: user.organization_id, now: now(), ttlMs: sessionTtlMs });
        await auditAuthEvent(tx, {
          organizationId: user.organization_id,
          userId: user.id,
          action: "login",
          traceId: context.requestId
        });
        attemptLimiter.reset(attemptKey);

        return { status: "authenticated", auth: await getAuthContext(tx, user.id), session } satisfies LocalAuthSessionResult;
      });
    },

    async resolveSession(authorization: string | string[] | undefined): Promise<AuthContext> {
      const token = bearerToken(authorization);
      const result = await db.query<SessionRow>(
        `
        select id, user_id, organization_id, expires_at::text as expires_at, revoked_at::text as revoked_at
        from auth_sessions
        where token_hash = $1
        limit 1
        `,
        [hashToken(token)]
      );
      const session = result.rows[0];
      if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= now().getTime()) {
        throw new ApiError("UNAUTHENTICATED", "Session is not active.");
      }
      await db.query("update auth_sessions set last_used_at = $2 where id = $1", [session.id, now().toISOString()]);
      return getAuthContext(db, session.user_id);
    },

    async logout(authorization: string | string[] | undefined, auth: AuthContext, context: { requestId: string }) {
      const token = optionalBearerToken(authorization);
      await db.transaction(async (tx) => {
        if (token) {
          await tx.query(
            `
            update auth_sessions
            set revoked_at = $2
            where token_hash = $1 and revoked_at is null
            `,
            [hashToken(token), now().toISOString()]
          );
        }
        await auditAuthEvent(tx, {
          organizationId: auth.organization.id,
          userId: auth.user.id,
          action: "logout",
          traceId: context.requestId
        });
      });
    },

    async changePassword(
      auth: AuthContext,
      input: ChangeLocalAccountPasswordInput,
      context: { requestId: string; authorization?: string | string[] }
    ) {
      requirePasswordPolicy(input.newPassword);
      if (input.currentPassword === input.newPassword) {
        throw new ApiError("VALIDATION_FAILED", "New password must be different from the current password.");
      }

      const user = await findUserForPasswordChange(db, auth.user.id);
      if (!user || !user.password_hash) {
        throw new ApiError("NOT_FOUND", "Local password credential was not found.");
      }
      if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
        throw new ApiError("UNAUTHENTICATED", "Current password is incorrect.");
      }

      const currentToken = optionalBearerToken(context.authorization);
      const currentTokenHash = currentToken ? hashToken(currentToken) : undefined;

      await db.transaction(async (tx) => {
        await updateLocalAccountPasswordHash(tx, { userId: user.id, passwordHash: await hashPassword(input.newPassword) });
        await revokeLocalUserSessions(tx, {
          userId: user.id,
          exceptTokenHash: currentTokenHash,
          revokedAt: now().toISOString()
        });
        await auditAuthEvent(tx, {
          organizationId: user.organization_id,
          userId: user.id,
          action: "change-password",
          traceId: context.requestId
        });
      });

      return { ok: true as const };
    },

    async updateCurrentUserProfile(auth: AuthContext, input: UpdateCurrentUserProfileInput, context: { requestId: string }) {
      const name = input.name?.trim();
      const title = input.title?.trim();
      if (name === "" || title === "") {
        throw new ApiError("VALIDATION_FAILED", "Profile fields cannot be blank.");
      }

      return db.transaction(async (tx) => {
        await tx.query(
          `
          update users
          set name = coalesce($3, name), title = coalesce($4, title)
          where organization_id = $1 and id = $2
          `,
          [auth.organization.id, auth.user.id, name, title]
        );
        await auditAuthEvent(tx, {
          organizationId: auth.organization.id,
          userId: auth.user.id,
          action: "update-profile",
          metadata: { fields: Object.keys(input) },
          traceId: context.requestId
        });
        return getAuthContext(tx, auth.user.id);
      });
    }
  };
}
