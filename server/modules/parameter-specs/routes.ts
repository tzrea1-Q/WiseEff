import { z } from "zod";
import { readSpecTaskWindow } from "../parameter-catalog-api/taskReadWindow";

import type { AuthContext } from "../auth/types";
import { canAdminParameters } from "../parameter-kernel/policy";
import { catalogLegacyGoneResult, legacyRouteSuccessor, LEGACY_WRITE_GONE_MESSAGE } from "../parameter-catalog-api/legacy/gone";
import { legacyWriteRouteManifest } from "../parameter-catalog-api/legacy/routes";
import {
  driverSchemaPromotionHistoryListResponseSchema,
} from "./promotionHistory";
import { listDriverSchemaPromotions } from "./driverSchemaOverlayRepository";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { listSpecReviewTasksQuerySchema } from "./schemas";
import { listSpecReviewTasks } from "./service";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Database adapter is required for parameter spec routes.",
    );
  }
  return db;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message = "Invalid parameter spec route input.",
) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

export function registerParameterSpecRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    getCurrentAuthContext: (
      request: RouteRequest,
    ) => Promise<AuthContext> | AuthContext;
  },
) {
  router.get("/api/v2/parameter-spec-review-tasks", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const query = parseWithSchema(
      listSpecReviewTasksQuerySchema,
      flattenQuery(request.query),
    );
    const result = await listSpecReviewTasks(db, auth, query);
    const window = await readSpecTaskWindow(db, auth, result.items);
    return { status: 200, headers: window.headers, body: { ...window.body, nextCursor: result.nextCursor } };
  });

  router.get("/api/v2/platform/driver-schema-promotion-history", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    if (!auth.user.isActive || !auth.permissions.includes("platform:schema-promote")) {
      throw new ApiError("FORBIDDEN", "Platform schema promotion history permission is required.");
    }
    const promotions = await listDriverSchemaPromotions(db);
    return {
      status: 200,
      body: driverSchemaPromotionHistoryListResponseSchema.parse({
        items: promotions.map((row) => ({
          id: row.id,
          platformSchemaId: row.platform_schema_id,
          sourceSchemaId: row.source_schema_id,
          sourceOrganizationId: row.source_organization_id,
          promotedByUserId: row.promoted_by_user_id,
          promotedAt: new Date(row.promoted_at).toISOString(),
          documentationSource: row.documentation_source,
        })),
      }),
    };
  });

  for (const route of legacyWriteRouteManifest.filter((entry) => entry.id.startsWith("parameterSpecs."))) {
    const add = router[route.method.toLowerCase() as Lowercase<typeof route.method>];
    add.call(router, route.path, async (request) =>
      catalogLegacyGoneResult(request.requestId, LEGACY_WRITE_GONE_MESSAGE, legacyRouteSuccessor(route.id)));
  }
}
