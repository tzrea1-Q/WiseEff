import type { WiseEffRouter } from "../../shared/http/router";
import type { AuthContext } from "./types";
import type { AuthContextResolver } from "./contextFactory";
import { ApiError } from "../../shared/http/errors";
import { z } from "zod";
import type { createLocalAuthService, LocalAuthSessionResult } from "./localAuth";

const platformRoleIdSchema = z.enum(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin"]);

export const developmentAuthContext: AuthContext = {
  user: {
    id: "u-xu-yun",
    organizationId: "org-chargelab",
    name: "Xu Yun",
    email: "xu@chargelab.cn",
    title: "Platform Owner",
    isActive: true
  },
  organization: {
    id: "org-chargelab",
    name: "ChargeLab"
  },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: [
    "parameter:view",
    "parameter:edit",
    "parameter:edit-critical",
    "debugging:use",
    "logs:view",
    "logs:upload",
    "logs:feedback",
    "logs:analyze",
    "logs:archive",
    "parameter:review",
    "admin:access",
    "users:manage"
  ]
};

const registerBodySchema = z.object({
  organization: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
  name: z.string().min(1),
  username: z.string().min(1),
  title: z.string().min(1).optional(),
  roleId: platformRoleIdSchema.optional(),
  password: z.string().min(8)
}).strict().refine((body) => Boolean(body.organization ?? body.organizationName), {
  path: ["organization"],
  message: "Organization is required."
});

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
}).strict();

const updateProfileBodySchema = z.object({
  name: z.string().min(1).optional(),
  title: z.string().min(1).optional()
});

type LocalAuthService = ReturnType<typeof createLocalAuthService>;

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

function sessionResponse(result: LocalAuthSessionResult) {
  return {
    auth: result.auth,
    token: result.session.token,
    expiresAt: result.session.expiresAt
  };
}

export function registerAuthRoutes(
  router: WiseEffRouter,
  options: { getCurrentAuthContext: AuthContextResolver; localAuthService?: LocalAuthService }
) {
  if (!options.getCurrentAuthContext) {
    throw new Error("Auth context resolver is required for auth routes.");
  }

  router.post("/api/v1/auth/register", async (request) => {
    if (!options.localAuthService) {
      throw new ApiError("NOT_FOUND", "Local account registration is not enabled.", 404);
    }
    const body = parseWithSchema(registerBodySchema, request.body, "Invalid registration input.");
    const result = await options.localAuthService.register(body, { requestId: request.requestId });
    if (result.status === "pending_approval") {
      return {
        status: 202,
        body: result
      };
    }
    return {
      status: 201,
      body: sessionResponse(result)
    };
  });

  router.post("/api/v1/auth/login", async (request) => {
    if (!options.localAuthService) {
      throw new ApiError("NOT_FOUND", "Local account login is not enabled.", 404);
    }
    const body = parseWithSchema(loginBodySchema, request.body, "Invalid login input.");
    const result = await options.localAuthService.login(body, { requestId: request.requestId });
    return {
      status: 200,
      body: sessionResponse(result)
    };
  });

  router.post("/api/v1/auth/logout", async (request) => {
    if (!options.localAuthService) {
      throw new ApiError("NOT_FOUND", "Local account logout is not enabled.", 404);
    }
    const auth = await options.getCurrentAuthContext(request);
    await options.localAuthService.logout(request.headers.authorization, auth, { requestId: request.requestId });
    return {
      status: 200,
      body: { ok: true }
    };
  });

  router.get("/api/v1/me", async (request) => {
    return {
      status: 200,
      body: await options.getCurrentAuthContext(request)
    };
  });

  router.patch("/api/v1/me/profile", async (request) => {
    if (!options.localAuthService) {
      throw new ApiError("NOT_FOUND", "Local profile updates are not enabled.", 404);
    }
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(updateProfileBodySchema, request.body, "Invalid profile input.");
    return {
      status: 200,
      body: await options.localAuthService.updateCurrentUserProfile(auth, body, { requestId: request.requestId })
    };
  });
}
