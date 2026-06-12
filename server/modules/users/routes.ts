import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  approveRegistrationRoleRequest,
  createUser,
  deactivateUser,
  listGovernedUsers,
  listRegistrationRoleRequests,
  rejectRegistrationRoleRequest,
  replaceUserRoles,
  updateUserProfile
} from "./service";
import { createUserBodySchema, replaceUserRolesBodySchema, updateUserActiveBodySchema, updateUserBodySchema } from "./schemas";

const userIdParamsSchema = z.object({
  userId: z.string().min(1)
});

const registrationRoleRequestParamsSchema = z.object({
  requestId: z.string().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for user governance routes.", 500);
  }

  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid user governance route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

export function registerUserRoutes(
  router: WiseEffRouter,
  options: { db?: Database; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.get("/api/v1/users", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const items = await listGovernedUsers(db, auth);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/users", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createUserBodySchema, request.body);
    const item = await createUser(db, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/users/registration-role-requests", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const items = await listRegistrationRoleRequests(db, auth);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/approve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await approveRegistrationRoleRequest(db, auth, params.requestId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/reject", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await rejectRegistrationRoleRequest(db, auth, params.requestId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/users/:userId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(updateUserBodySchema, request.body);
    const item = await updateUserProfile(db, auth, params.userId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/users/:userId/activation", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(updateUserActiveBodySchema, request.body);
    const item = await deactivateUser(db, auth, params.userId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.put("/api/v1/users/:userId/roles", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(replaceUserRolesBodySchema, request.body);
    const item = await replaceUserRoles(db, auth, params.userId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });
}
