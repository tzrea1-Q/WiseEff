import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  approveRegistrationRoleRequest,
  enableBasicRegistrationRoleRequest,
  createUser,
  deactivateUser,
  deleteUser,
  getHomeOrganization,
  getProjectRoleBindings,
  listGovernedUsers,
  listRegistrationRoleRequests,
  rejectRegistrationRoleRequest,
  replaceOrganizationRoles,
  replaceProjectWorkflowRoles,
  replaceUserRoles,
  resetUserPassword,
  updateHomeOrganization,
  updateUserProfile
} from "./service";
import {
  createUserBodySchema,
  setOidcIdentityBodySchema,
  listRegistrationRoleRequestsQuerySchema,
  replaceUserRolesBodySchema,
  resetUserPasswordBodySchema,
  updateOrganizationBodySchema,
  updateOrganizationRolesBodySchema,
  updateProjectWorkflowRolesBodySchema,
  updateUserActiveBodySchema,
  updateUserBodySchema
} from "./schemas";
import { setOidcIdentity } from "../auth/oidcIdentity";
import { createUserInvocation } from "../auth/trustedInvocation";
import { getUserById } from "./repository";

const userIdParamsSchema = z.object({
  userId: z.string().min(1)
});

const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

const projectUserParamsSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1)
});

const registrationRoleRequestParamsSchema = z.object({
  requestId: z.string().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for user governance routes.");
  }

  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid user governance route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }

  return parsed.data;
}

export function registerUserRoutes(
  router: WiseEffRouter,
  options: { db?: Database; oidcIssuer?: string; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.get("/api/v1/organization", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const organization = await getHomeOrganization(db, auth);

    return { status: 200, body: { organization } };
  });

  router.patch("/api/v1/organization", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(updateOrganizationBodySchema, request.body);
    const organization = await updateHomeOrganization(db, auth, body, { requestId: request.requestId });

    return { status: 200, body: { organization } };
  });

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
    if (options.oidcIssuer && !("authentication" in body)) throw new ApiError("VALIDATION_FAILED", "OIDC provisioning requires an explicit subject instead of a local password.");
    const item = await createUser(db, auth, body, { requestId: request.requestId }, options.oidcIssuer);

    return { status: 201, body: { item } };
  });

  router.put("/api/v1/users/:userId/oidc-identity", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    const { userId } = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(setOidcIdentityBodySchema, request.body);
    await setOidcIdentity(db, createUserInvocation(auth), userId, body, options.oidcIssuer, { requestId: request.requestId });
    const item = await getUserById(db, { organizationId: auth.organization.id,userId });
    return { status: 200,body: { item: item! } };
  });

  router.get("/api/v1/users/registration-role-requests", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listRegistrationRoleRequestsQuerySchema, request.query);
    const items = await listRegistrationRoleRequests(db, auth, query.status);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/approve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await approveRegistrationRoleRequest(db, auth, params.requestId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/enable-basic", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await enableBasicRegistrationRoleRequest(db, auth, params.requestId, { requestId: request.requestId });
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

  router.delete("/api/v1/users/:userId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    await deleteUser(db, auth, params.userId, { requestId: request.requestId });

    return { status: 204, body: null };
  });

  router.post("/api/v1/users/:userId/password", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(resetUserPasswordBodySchema, request.body);
    const item = await resetUserPassword(db, auth, params.userId, body, { requestId: request.requestId });

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

  router.put("/api/v1/users/:userId/organization-roles", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(updateOrganizationRolesBodySchema, request.body);
    const item = await replaceOrganizationRoles(db, auth, params.userId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/workflow-role-bindings", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectIdParamsSchema, request.params);
    const item = await getProjectRoleBindings(db, auth, params.projectId);

    return { status: 200, body: item };
  });

  router.put("/api/v1/projects/:projectId/workflow-role-bindings/:userId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectUserParamsSchema, request.params);
    const body = parseWithSchema(updateProjectWorkflowRolesBodySchema, request.body);
    const item = await replaceProjectWorkflowRoles(db, auth, params.projectId, params.userId, body, {
      requestId: request.requestId
    });

    return { status: 200, body: { item } };
  });
}
