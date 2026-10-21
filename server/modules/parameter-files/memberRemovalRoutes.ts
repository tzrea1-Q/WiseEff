import { z } from "zod";
import type { Database } from "../../shared/database/client";
import type { WiseEffRouter, RouteRequest } from "../../shared/http/router";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { ObjectStore } from "../logs/objectStore";
import { applyAdministratorMemberRemoval, previewAdministratorMemberRemoval } from "./canonicalMemberRemoval";
import { administratorMemberRemovalApplyRequestSchema } from "../contracts/dtoSchemas/memberRemoval";

export const memberRemovalParamsSchema = z.object({ projectId: z.string().min(1), configSetId: z.string().min(1), fileId: z.string().min(1) });
export const memberRemovalApplySchema = administratorMemberRemovalApplyRequestSchema;

export function registerMemberRemovalRoutes(router: WiseEffRouter, options: { db?: Database; objectStore?: ObjectStore;
  getCurrentAuthContext: (request: RouteRequest) => AuthContext | Promise<AuthContext>; refusalAuditSink?: TrustedRefusalAuditSink }) {
  const handler = (operation: "removal-preview" | "removal-apply") => async (request: RouteRequest) => {
    if (!options.db || !options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source database and storage are required.");
    const params = memberRemovalParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiError("VALIDATION_FAILED", "Invalid configuration member.");
    const auth = await options.getCurrentAuthContext(request);
    if (operation === "removal-preview") return { status: 200, body: { item: await previewAdministratorMemberRemoval(options.db, options.objectStore, auth, params.data) } };
    const body = memberRemovalApplySchema.safeParse(request.body);
    if (!body.success) throw new ApiError("VALIDATION_FAILED", "请填写移除原因并重新预览。", { issues: body.error.issues });
    if (!options.refusalAuditSink) throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required.");
    const item = await applyAdministratorMemberRemoval(options.db, options.objectStore, auth, { ...params.data, ...body.data },
      { invocation: createUserInvocation(auth), requestId: request.requestId, refusalSink: options.refusalAuditSink });
    return { status: 200, body: { item } };
  };
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId/removal-preview", handler("removal-preview"));
  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId/removal-apply", handler("removal-apply"));
}
