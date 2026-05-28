import type { WiseEffRouter } from "../../shared/http/router";
import type { AuthContext } from "./types";
import type { AuthContextResolver } from "./contextFactory";

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

export function registerAuthRoutes(router: WiseEffRouter, options: { getCurrentAuthContext: AuthContextResolver }) {
  if (!options.getCurrentAuthContext) {
    throw new Error("Auth context resolver is required for auth routes.");
  }

  router.get("/api/v1/me", async (request) => {
    return {
      status: 200,
      body: await options.getCurrentAuthContext(request)
    };
  });
}
