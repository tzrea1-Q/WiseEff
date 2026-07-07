import { z } from "zod";
import type { AuthContext } from "../../auth/types";
import type { Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../../shared/http/router";
import { canViewParameters } from "../policy";
import { dashboardHotspotsQuerySchema, dashboardSummaryQuerySchema } from "./schemas";
import { getDashboardHotspots, getDashboardSummary } from "./service";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for dashboard routes.", 500);
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid dashboard route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function registerParameterDashboardRoutes(
  router: WiseEffRouter,
  options: { db?: Database; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.get("/api/v1/parameters/dashboard/summary", async (request) => {
    const auth = await options.getCurrentAuthContext(request);
    if (!canViewParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
    }
    const query = parseWithSchema(dashboardSummaryQuerySchema, request.query);
    const item = await getDashboardSummary(requireDb(options.db), {
      auth,
      projectId: query.projectId,
      window: query.window ?? "30d"
    });
    return { status: 200, body: { item } };
  });

  router.get("/api/v1/parameters/dashboard/hotspots", async (request) => {
    const auth = await options.getCurrentAuthContext(request);
    if (!canViewParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
    }
    const query = parseWithSchema(dashboardHotspotsQuerySchema, request.query);
    const items = await getDashboardHotspots(requireDb(options.db), {
      auth,
      projectId: query.projectId,
      window: query.window ?? "30d",
      dimension: query.dimension ?? "overall"
    });
    return { status: 200, body: { items } };
  });
}
