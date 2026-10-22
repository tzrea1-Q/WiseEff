import type { Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../../shared/http/router";
import type { AuthContext } from "../../auth/types";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { catalogDeleteDefinitionRequestSchema } from "../../contracts/dtoSchemas/parameterDefinitionDeletion";
import type { DefinitionArchiveStores } from "./archives";
import { deleteDefinition, listDefinitionErasures, retryDefinitionCleanup, previewDefinitionDeletion, requireDefinitionErasureAdministrator } from "./service";

export function registerDefinitionDeletionRoutes(router: WiseEffRouter, options: DefinitionArchiveStores & {
  db?: Database; resolveAuth: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}) {
  const database = () => {
    if (!options.db) throw new ApiError("CONFLICT", "参数定义管理服务暂不可用。");
    return options.db;
  };
  const path = "/api/v2/catalog/definitions/:definitionId";
  router.get("/api/v2/catalog/definition-erasures", async request => {
    const auth = await options.resolveAuth(request);
    return { status: 200, body: await listDefinitionErasures(database(), auth) };
  });
  router.post("/api/v2/catalog/definition-erasures/:definitionId/retry-cleanup", async request => {
    const auth = await options.resolveAuth(request);
    return { status: 200, body: await retryDefinitionCleanup(database(), createUserInvocation(auth),
      request.params.definitionId!, request.requestId, options) };
  });
  router.get(`${path}/deletion-preview`, async request => {
    const auth = await options.resolveAuth(request);
    requireDefinitionErasureAdministrator(auth);
    return { status: 200, body: await previewDefinitionDeletion(database(), auth, request.params.definitionId!, options) };
  });
  router.delete(path, async request => {
    const auth = await options.resolveAuth(request);
    requireDefinitionErasureAdministrator(auth);
    const parsed = catalogDeleteDefinitionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "请先读取并确认删除影响。", { issues: parsed.error.issues });
    return { status: 200, body: await deleteDefinition(database(), createUserInvocation(auth),
      request.params.definitionId!, parsed.data.previewToken, request.requestId, options) };
  });
}
