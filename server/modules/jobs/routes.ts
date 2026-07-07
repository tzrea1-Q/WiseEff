import { z } from "zod";
import type { AuthContext } from "../auth/types";
import { requireLogView } from "../logs/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { getJobSnapshot } from "./repository";
import type { LogAnalysisJobSnapshotDto } from "./types";

const paramsWithJobIdSchema = z.object({
  jobId: z.string().min(1)
});

const terminalStatuses = new Set(["complete", "failed"]);

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for job routes.", 500);
  }

  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid job route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadVisibleJob(db: Database, auth: AuthContext, jobId: string) {
  requireLogView(auth);
  const item = await getJobSnapshot(db, jobId);
  if (!item || item.organizationId !== auth.organization.id) {
    throw new ApiError("NOT_FOUND", "Job was not found.", 404, { jobId });
  }

  return item;
}

async function* streamJobEvents(
  db: Database,
  auth: AuthContext,
  jobId: string,
  initialSnapshot: LogAnalysisJobSnapshotDto
): AsyncIterable<{ event: string; data: LogAnalysisJobSnapshotDto }> {
  let snapshot = initialSnapshot;
  yield { event: "job", data: snapshot };

  const stopAt = Date.now() + 10_000;
  while (!terminalStatuses.has(snapshot.status) && Date.now() < stopAt) {
    await delay(1000);
    snapshot = await loadVisibleJob(db, auth, jobId);
    yield { event: "job", data: snapshot };
  }
}

export function registerJobRoutes(
  router: WiseEffRouter,
  options: { db?: Database; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.get("/api/v1/jobs/:jobId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithJobIdSchema, request.params);
    const item = await loadVisibleJob(db, auth, params.jobId);

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/jobs/:jobId/events", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithJobIdSchema, request.params);
    const initialSnapshot = await loadVisibleJob(db, auth, params.jobId);

    return { status: 200, sse: streamJobEvents(db, auth, params.jobId, initialSnapshot) };
  });
}
