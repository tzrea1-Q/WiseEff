import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { ApiError } from "../../shared/http/errors";
import { permissionsForRoles } from "./policy";
import type { AuthContext, BackendRoleId, RoleBinding } from "./types";
import type { TokenVerifier } from "./tokenVerifier";

type Jwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

type Jwks = {
  keys: Jwk[];
};

type OidcDiscovery = {
  jwksUri: string;
};

export type OidcVerifierOptions = {
  issuer: string;
  audience: string;
  jwks?: Jwks;
  discovery?: () => Promise<OidcDiscovery>;
  fetchJwks?: (jwksUri?: string) => Promise<Jwks>;
  now?: () => Date;
};

const roleIds = new Set<BackendRoleId>(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"]);

function bearerToken(authorization: string | string[] | undefined) {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) {
    throw new ApiError("UNAUTHENTICATED", "Authorization bearer token is required.", 401);
  }
  return match[1];
}

function parseToken(token: string) {
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token format is invalid.", 401);
  }

  return {
    headerPart,
    payloadPart,
    signaturePart,
    header: parseJwtPart(headerPart, "OIDC token header is invalid."),
    claims: parseJwtPart(payloadPart, "OIDC token payload is invalid.")
  };
}

function parseJwtPart(part: string, errorMessage: string) {
  try {
    const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError("UNAUTHENTICATED", errorMessage, 401);
  }
}

function stringClaim(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberClaim(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanClaim(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "boolean" ? value : undefined;
}

function hasAudience(claims: Record<string, unknown>, audience: string) {
  const aud = claims.aud;
  return aud === audience || (Array.isArray(aud) && aud.includes(audience));
}

function validateClaims(claims: Record<string, unknown>, options: Pick<OidcVerifierOptions, "issuer" | "audience" | "now">) {
  if (stringClaim(claims, "iss") !== options.issuer) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token issuer is not trusted.", 401);
  }
  if (!hasAudience(claims, options.audience)) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token audience is not accepted.", 401);
  }

  const exp = numberClaim(claims, "exp");
  if (exp === undefined) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token expiration claim is required.", 401);
  }
  const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  if (exp <= nowSeconds) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token has expired.", 401);
  }

  const nbf = numberClaim(claims, "nbf");
  if (nbf !== undefined && nbf > nowSeconds) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token is not valid yet.", 401);
  }
}

function parseRoles(value: unknown): RoleBinding[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token role claims are invalid.", 401);
  }

  return value.map((role) => {
    if (!role || typeof role !== "object" || Array.isArray(role)) {
      throw new ApiError("UNAUTHENTICATED", "OIDC token role claims are invalid.", 401);
    }
    const roleId = (role as { roleId?: unknown }).roleId;
    const projectId = (role as { projectId?: unknown }).projectId;
    if (typeof roleId !== "string" || !roleIds.has(roleId as BackendRoleId)) {
      throw new ApiError("UNAUTHENTICATED", "OIDC token role claims are invalid.", 401);
    }
    if (projectId !== undefined && projectId !== null && typeof projectId !== "string") {
      throw new ApiError("UNAUTHENTICATED", "OIDC token role claims are invalid.", 401);
    }

    return { roleId: roleId as BackendRoleId, projectId: projectId ?? null };
  });
}

function isAcceptedSigningKey(key: Jwk) {
  return key.kty === "RSA" && (key.use === undefined || key.use === "sig") && (key.alg === undefined || key.alg === "RS256");
}

function keyForKid(jwks: Jwks, kid: string | undefined) {
  if (!kid) return undefined;
  return jwks.keys.find((key) => key.kid === kid && isAcceptedSigningKey(key));
}

function verifyJwtSignature(input: { headerPart: string; payloadPart: string; signaturePart: string; jwk: Jwk }) {
  const publicKey = createPublicKey({ key: input.jwk, format: "jwk" });
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${input.headerPart}.${input.payloadPart}`),
    publicKey,
    Buffer.from(input.signaturePart, "base64url")
  );
  if (!valid) {
    throw new ApiError("UNAUTHENTICATED", "OIDC token signature is invalid.", 401);
  }
}

export function createOidcVerifier(options: OidcVerifierOptions): TokenVerifier {
  let jwksCache = options.jwks;
  let jwksUri: string | undefined;

  async function loadJwks(refresh = false) {
    if (jwksCache && !refresh) {
      return jwksCache;
    }
    if (!options.fetchJwks) {
      throw new ApiError("UNAUTHENTICATED", "OIDC JWKS is not configured.", 401);
    }
    if (!jwksUri && options.discovery) {
      jwksUri = (await options.discovery()).jwksUri;
    }
    jwksCache = await options.fetchJwks(jwksUri);
    return jwksCache;
  }

  return {
    async verify(authorization) {
      const parsed = parseToken(bearerToken(authorization));
      if (parsed.header.alg !== "RS256") {
        throw new ApiError("UNAUTHENTICATED", "OIDC token algorithm is not accepted.", 401);
      }

      let jwks = await loadJwks();
      let jwk = keyForKid(jwks, stringClaim(parsed.header, "kid"));
      if (!jwk && options.fetchJwks) {
        jwks = await loadJwks(true);
        jwk = keyForKid(jwks, stringClaim(parsed.header, "kid"));
      }
      if (!jwk) {
        throw new ApiError("UNAUTHENTICATED", "OIDC signing key was not found.", 401);
      }

      verifyJwtSignature({ ...parsed, jwk });
      validateClaims(parsed.claims, options);
      const roles = parseRoles(parsed.claims.wiseeff_roles);
      const organizationId = stringClaim(parsed.claims, "organization_id");
      const subject = stringClaim(parsed.claims, "sub");
      if (!subject || !organizationId) {
        throw new ApiError("UNAUTHENTICATED", "OIDC subject and organization claims are required.", 401);
      }

      return {
        user: {
          id: subject,
          organizationId,
          name: stringClaim(parsed.claims, "name") ?? subject,
          email: stringClaim(parsed.claims, "email") ?? `${subject}@${organizationId}`,
          emailVerified: booleanClaim(parsed.claims, "email_verified") ?? false,
          title: stringClaim(parsed.claims, "title") ?? "User",
          isActive: parsed.claims.is_active === undefined ? true : parsed.claims.is_active === true
        },
        organization: {
          id: organizationId,
          name: stringClaim(parsed.claims, "organization_name") ?? organizationId
        },
        roles,
        permissions: permissionsForRoles(roles.map((role) => role.roleId))
      };
    }
  };
}
