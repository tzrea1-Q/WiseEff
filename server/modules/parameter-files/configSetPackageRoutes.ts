import { z } from "zod";
import type { Database } from "../../shared/database/client";
import { isRootDatabase } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import { configSetImportApplyBodySchema, configSetImportPreviewBodySchema } from "../contracts/dtoSchemas/configSetPackage";
import type { ObjectStore } from "../logs/objectStore";
import { parameterInvocation, parameterRequestAccess } from "../parameters/operatingScope";
import { applyConfigSetImport, previewConfigSetImport } from "./configSetPackage";

export function registerConfigSetPackageRoutes(router: WiseEffRouter, options: { db?: Database; objectStore?: ObjectStore;
  refusalAuditSink?: TrustedRefusalAuditSink; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }) {
  const sink = options.refusalAuditSink ?? (options.db && isRootDatabase(options.db) ? createTrustedRefusalAuditSink(options.db) : undefined);
  async function handle(request: RouteRequest, apply: boolean) {
    if (!options.db || !options.objectStore || !sink) throw new ApiError("INTERNAL_ERROR", "Configuration import storage and refusal auditing are required.");
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const security = { invocation: parameterInvocation(auth) ?? createUserInvocation(auth), requestId: request.requestId, refusalSink: sink };
    const parsed = (apply ? configSetImportApplyBodySchema : configSetImportPreviewBodySchema).safeParse(request.body);
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "配置包、归属选择或确认信息不完整。", { issues: parsed.error.issues });
    const item = apply ? await applyConfigSetImport(options.db, options.objectStore, auth, params.projectId, configSetImportApplyBodySchema.parse(parsed.data), security)
      : await previewConfigSetImport(options.db, auth, params.projectId, parsed.data, security);
    return { status: 200, body: { item } };
  }
  router.post("/api/v1/projects/:projectId/config-set-import/preview", request => handle(request, false));
  router.post("/api/v1/projects/:projectId/config-set-import/apply", request => handle(request, true));
}
