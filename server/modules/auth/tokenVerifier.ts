import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission, BackendRoleId, RoleBinding } from "./types";

export type TokenVerifier = {
  verify(authorization: string | string[] | undefined): Promise<AuthContext>;
};

export type TokenVerifierOptions = {
  issuer: string;
  secret: string;
  now?: () => Date;
};

const roleIds = new Set<BackendRoleId>(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"]);
const permissionIds = new Set<BackendPermission>([
  "parameter:view",
  "parameter:edit",
  "parameter:edit-critical",
  "debugging:use",
  "debugging:view",
  "debugging:read",
  "debugging:write",
  "debugging:rollback",
  "debugging:admin",
  "logs:view",
  "logs:upload",
  "logs:analyze",
  "logs:archive",
  "logs:feedback",
  "parameter:review",
  "admin:access",
  "users:manage"
]);

function readBearerToken(authorization: string | string[] | undefined) {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) {
    throw new ApiError("UNAUTHENTICATED", "Authorization bearer token is required.", 401);
  }
  return match[1];
}

function verifySignature(payload: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new ApiError("UNAUTHENTICATED", "Token signature is invalid.", 401);
  }
}

function parseStringClaim(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseNumericDateClaim(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validateLifetime(claims: Record<string, unknown>, now: Date) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const exp = parseNumericDateClaim(claims, "exp");
  if (exp === undefined) {
    throw new ApiError("UNAUTHENTICATED", "Token expiration claim is required.", 401);
  }
  if (exp <= nowSeconds) {
    throw new ApiError("UNAUTHENTICATED", "Token has expired.", 401);
  }

  const nbf = parseNumericDateClaim(claims, "nbf");
  if (nbf !== undefined && nbf > nowSeconds) {
    throw new ApiError("UNAUTHENTICATED", "Token is not valid yet.", 401);
  }
}

function parseRoles(value: unknown): RoleBinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((role) => {
    if (!role || typeof role !== "object") {
      throw new ApiError("UNAUTHENTICATED", "Token role claims are invalid.", 401);
    }
    const roleId = (role as { roleId?: unknown }).roleId;
    const projectId = (role as { projectId?: unknown }).projectId;
    if (typeof roleId !== "string" || !roleIds.has(roleId as BackendRoleId)) {
      throw new ApiError("UNAUTHENTICATED", "Token role claims are invalid.", 401);
    }
    if (projectId !== null && projectId !== undefined && typeof projectId !== "string") {
      throw new ApiError("UNAUTHENTICATED", "Token role claims are invalid.", 401);
    }
    return { roleId: roleId as BackendRoleId, projectId: projectId ?? null };
  });
}

function parsePermissions(value: unknown): BackendPermission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((permission) => {
    if (typeof permission !== "string" || !permissionIds.has(permission as BackendPermission)) {
      throw new ApiError("UNAUTHENTICATED", "Token permission claims are invalid.", 401);
    }
    return permission as BackendPermission;
  });
}

function parseClaims(payload: string) {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected object claims.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError("UNAUTHENTICATED", "Token payload is invalid.", 401);
  }
}

export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  return {
    async verify(authorization) {
      const token = readBearerToken(authorization);
      const [payload, signature, extra] = token.split(".");
      if (!payload || !signature || extra !== undefined) {
        throw new ApiError("UNAUTHENTICATED", "Bearer token format is invalid.", 401);
      }

      verifySignature(payload, signature, options.secret);
      const claims = parseClaims(payload);
      const issuer = parseStringClaim(claims, "iss");
      const subject = parseStringClaim(claims, "sub");
      const organizationId = parseStringClaim(claims, "org");
      if (!issuer || !subject || !organizationId) {
        throw new ApiError("UNAUTHENTICATED", "Token issuer, subject, and organization claims are required.", 401);
      }
      if (issuer !== options.issuer) {
        throw new ApiError("UNAUTHENTICATED", "Token issuer is not trusted.", 401);
      }
      validateLifetime(claims, options.now?.() ?? new Date());

      return {
        user: {
          id: subject,
          organizationId,
          name: parseStringClaim(claims, "name") ?? subject,
          email: parseStringClaim(claims, "email") ?? `${subject}@${organizationId}`,
          title: parseStringClaim(claims, "title") ?? "User",
          isActive: claims.isActive === undefined ? true : claims.isActive === true
        },
        organization: {
          id: organizationId,
          name: parseStringClaim(claims, "orgName") ?? organizationId
        },
        roles: parseRoles(claims.roles),
        permissions: parsePermissions(claims.permissions)
      };
    }
  };
}
