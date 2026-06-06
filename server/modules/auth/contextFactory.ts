import type { RouteRequest } from "../../shared/http/router";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "./types";
import type { TokenVerifier } from "./tokenVerifier";
import type { Queryable } from "../../shared/database/client";
import { getAuthContextForExternalIdentity } from "./repository";

export type AuthMode = "development" | "production";

export type AuthContextResolver = (request: Pick<RouteRequest, "headers">) => Promise<AuthContext>;

export type AuthContextResolverOptions = {
  mode: AuthMode;
  verifier?: TokenVerifier;
  db?: Queryable;
  developmentAuthContext?: AuthContext;
  getDevelopmentAuthContext?: (request: Pick<RouteRequest, "headers">) => Promise<AuthContext> | AuthContext;
};

export function createAuthContextResolver(options: AuthContextResolverOptions): AuthContextResolver {
  if (options.mode === "production") {
    if (!options.verifier) {
      throw new Error("Production auth verifier is required when AUTH_MODE=production.");
    }

    return async (request) => {
      try {
        const verifiedContext = await options.verifier!.verify(request.headers.authorization);
        if (!options.db) {
          throw new ApiError("INTERNAL_ERROR", "Database-backed auth context is required when AUTH_MODE=production.", 500);
        }
        return await getAuthContextForExternalIdentity(options.db, {
          organizationId: verifiedContext.user.organizationId,
          subject: verifiedContext.user.id,
          email: verifiedContext.user.emailVerified ? verifiedContext.user.email : undefined
        });
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        throw new ApiError("UNAUTHENTICATED", error instanceof Error ? error.message : "Authentication failed.", 401);
      }
    };
  }

  return async (request) => {
    if (options.getDevelopmentAuthContext) {
      return options.getDevelopmentAuthContext(request);
    }
    if (!options.developmentAuthContext) {
      throw new Error("Development auth context is required in development mode.");
    }
    return options.developmentAuthContext;
  };
}
