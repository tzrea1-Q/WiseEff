import type { Queryable } from "../../shared/database/client";
import type { WiseEffRouter } from "../../shared/http/router";
import { getAuthContext } from "./repository";
import type { AuthContext } from "./types";

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
  permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]
};

export function registerAuthRoutes(router: WiseEffRouter, options: { db?: Queryable }) {
  router.get("/api/v1/me", async (request) => {
    const userId = request.headers["x-wiseeff-user"]?.toString() ?? developmentAuthContext.user.id;
    const context = options.db ? await getAuthContext(options.db, userId) : developmentAuthContext;

    return {
      status: 200,
      body: context
    };
  });
}
