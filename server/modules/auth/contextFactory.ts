import type { RouteRequest } from "../../shared/http/router";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "./types";
import type { TokenVerifier } from "./tokenVerifier";

export type AuthMode = "development" | "production";

export type AuthContextResolver = (request: Pick<RouteRequest, "headers">) => Promise<AuthContext>;

export type AuthContextResolverOptions = {
  mode: AuthMode;
  verifier?: TokenVerifier;
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
        return await options.verifier!.verify(request.headers.authorization);
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
