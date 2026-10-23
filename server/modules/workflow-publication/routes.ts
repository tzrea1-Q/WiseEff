import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { getWorkflowPublication, getWorkflowPublicationAdmin, updateWorkflowPublication } from "./service";

export function registerWorkflowPublicationRoutes(router: WiseEffRouter, options: {
  db?: Database;
  getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}) {
  function requireDb(): Database {
    if (!options.db) throw new ApiError("INTERNAL_ERROR", "工作流发布配置暂不可用，请重试。", { reason: "workflow-publication-unavailable" });
    return options.db;
  }

  router.get("/api/v1/workflow-publication", async (request) => {
    const auth = await options.getCurrentAuthContext(request);
    return { status: 200, headers: { "Cache-Control": "no-store" }, body: { item: await getWorkflowPublication(requireDb(), auth) } };
  });
  router.get("/api/v1/admin/workflow-publication", async (request) => {
    const auth = await options.getCurrentAuthContext(request);
    return { status: 200, headers: { "Cache-Control": "no-store" }, body: { item: await getWorkflowPublicationAdmin(requireDb(), auth) } };
  });
  router.put("/api/v1/admin/workflow-publication", async (request) => {
    const auth = await options.getCurrentAuthContext(request);
    return { status: 200, headers: { "Cache-Control": "no-store" }, body: { item: await updateWorkflowPublication(requireDb(), createUserInvocation(auth), request.body, request.requestId) } };
  });
}
