import { parameterInvocation, parameterRequestAccess } from "../parameters/operatingScope";
import { z } from "zod";
import { isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { assertTrustedRefusalAuditSink, createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { applyCanonicalMemberAddition, previewCanonicalMemberAddition } from "./canonicalMemberAddition";
import { memberAdditionBodySchema, memberAdditionApplyBodySchema } from "../contracts/dtoSchemas/canonicalMemberAddition";

export function registerCanonicalMemberAdditionRoutes(router: WiseEffRouter, options: {
  db?: Database; objectStore?: ObjectStore; refusalAuditSink?: TrustedRefusalAuditSink;
  getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
}) {
  const sink = options.refusalAuditSink ?? (options.db && isRootDatabase(options.db) ? createTrustedRefusalAuditSink(options.db) : undefined);
  if (sink) assertTrustedRefusalAuditSink(sink);
  async function handle(request: RouteRequest, operation: "preview" | "apply") {
    if (!options.db || !options.objectStore || !sink) throw new ApiError("INTERNAL_ERROR", "Configuration source storage and refusal auditing are required.");
    const params = z.object({ projectId: z.string().min(1), configSetId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) throw new ApiError("VALIDATION_FAILED", "Invalid configuration target.");
    const auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request), security = { invocation: parameterInvocation(auth) ?? createUserInvocation(auth), requestId: request.requestId, refusalSink: sink };
    if (operation === "preview") {
      const body = memberAdditionBodySchema.safeParse(request.body);
      if (!body.success) throw new ApiError("VALIDATION_FAILED", "文件、用途、顺序或 JSON 映射不完整。", { issues: body.error.issues });
      return { status: 200, body: { item: await previewCanonicalMemberAddition(options.db, options.objectStore, auth, { ...params.data, ...body.data }, security) } };
    }
    const body = memberAdditionApplyBodySchema.safeParse(request.body);
    if (!body.success) throw new ApiError("VALIDATION_FAILED", "确认预览、原因或操作编号不完整。", { issues: body.error.issues });
    return { status: 200, body: { item: await applyCanonicalMemberAddition(options.db, options.objectStore, auth, { ...params.data, ...body.data }, security) } };
  }
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/preview", (request) => handle(request, "preview"));
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/member-addition/apply", (request) => handle(request, "apply"));
}
