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
  listGovernedProjectCandidates,
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
import { resolveOperatingContext } from "../auth/operatingContext";
import { getUserById } from "./repository";
import { createPlatformOrganizationSchema, emergencyDisableAdministratorSchema, recoverOrganizationAdministratorSchema } from "../contracts/dtoSchemas/platformOrganizations";
import { createPlatformOrganization, emergencyDisableAdministrator, getAdministratorRecovery, listPlatformOrganizations, recoverOrganizationAdministrator, requirePlatformOrganizationManager } from "./platformOrganizations";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";

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
  options: { db?: Database; oidcIssuer?: string; authenticationProvider?: "local" | "oidc" | "hmac"; bridgeConnectionPool?: Pick<BridgeConnectionPool, "disconnect">; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  const mutationContext = (request: RouteRequest) => ({ requestId: request.requestId, authenticationProvider: options.authenticationProvider, oidcIssuer: options.oidcIssuer, bridgeConnectionPool: options.bridgeConnectionPool });
  const operatingInvocation = (db: Database, auth: AuthContext, request: RouteRequest) => {
    const query = parseWithSchema(z.object({ organizationId: z.string().trim().min(1).max(200).optional() }), request.query);
    return query.organizationId === undefined ? createUserInvocation(auth) : resolveOperatingContext(db, createUserInvocation(auth), query.organizationId);
  };
  router.get("/api/v1/platform/organizations/:organizationId/administrator-recovery", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    return { status: 200, body: await getAdministratorRecovery(db, createUserInvocation(auth), request.params.organizationId, mutationContext(request)) };
  });
  router.post("/api/v1/platform/organizations/:organizationId/administrator-recovery", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(recoverOrganizationAdministratorSchema, request.body);
    return { status: 200, body: { item: await recoverOrganizationAdministrator(db, createUserInvocation(auth), request.params.organizationId, body, options.oidcIssuer, mutationContext(request)) } };
  });
  router.post("/api/v1/platform/organizations/:organizationId/administrators/:userId/emergency-disable", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(emergencyDisableAdministratorSchema, request.body);
    return { status: 200, body: { item: await emergencyDisableAdministrator(db, createUserInvocation(auth), request.params.organizationId, request.params.userId, body.reason, mutationContext(request)) } };
  });
  router.get("/api/v1/platform/organizations", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    requirePlatformOrganizationManager(auth);
    const query = parseWithSchema(z.object({ q: z.string().trim().max(200).optional() }).strict(), request.query);
    return { status: 200, body: { items: await listPlatformOrganizations(db, auth, query.q, undefined, mutationContext(request)) } };
  });
  router.get("/api/v1/platform/organizations/:organizationId", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    requirePlatformOrganizationManager(auth);
    const item = (await listPlatformOrganizations(db, auth, "", request.params.organizationId, mutationContext(request)))[0];
    if (!item) throw new ApiError("NOT_FOUND", "Organization was not found.");
    return { status: 200, body: { item } };
  });
  router.post("/api/v1/platform/organizations", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    requirePlatformOrganizationManager(auth);
    const body = parseWithSchema(createPlatformOrganizationSchema, request.body);
    return { status: 201, body: { item: await createPlatformOrganization(db, createUserInvocation(auth), body, options.oidcIssuer, mutationContext(request)) } };
  });
  router.get("/api/v1/organization", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const organization = await getHomeOrganization(db, await operatingInvocation(db, auth, request));

    return { status: 200, body: { organization } };
  });

  router.get("/api/v1/organization/project-candidates", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    return { status: 200, body: { items: await listGovernedProjectCandidates(db, await operatingInvocation(db, auth, request)) } };
  });

  router.patch("/api/v1/organization", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(updateOrganizationBodySchema, request.body);
    const organization = await updateHomeOrganization(db, await operatingInvocation(db, auth, request), body, { requestId: request.requestId });

    return { status: 200, body: { organization } };
  });

  router.get("/api/v1/users", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const items = await listGovernedUsers(db, await operatingInvocation(db, auth, request));

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/users", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createUserBodySchema, request.body);
    if (options.oidcIssuer && !("authentication" in body)) throw new ApiError("VALIDATION_FAILED", "OIDC provisioning requires an explicit subject instead of a local password.");
    const item = await createUser(db, await operatingInvocation(db, auth, request), body, { requestId: request.requestId }, options.oidcIssuer);

    return { status: 201, body: { item } };
  });

  router.put("/api/v1/users/:userId/oidc-identity", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    const { userId } = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(setOidcIdentityBodySchema, request.body);
    const invocation = await operatingInvocation(db, auth, request);
    await setOidcIdentity(db, invocation, userId, body, options.oidcIssuer, { requestId: request.requestId });
    const item = await getUserById(db, { organizationId: invocation.operatingOrganization?.id ?? auth.organization.id,userId });
    return { status: 200,body: { item: item! } };
  });

  router.get("/api/v1/users/registration-role-requests", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listRegistrationRoleRequestsQuerySchema, request.query);
    const items = await listRegistrationRoleRequests(db, await operatingInvocation(db, auth, request), query.status);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/approve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await approveRegistrationRoleRequest(db, await operatingInvocation(db, auth, request), params.requestId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/enable-basic", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await enableBasicRegistrationRoleRequest(db, await operatingInvocation(db, auth, request), params.requestId, { requestId: request.requestId });
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/users/registration-role-requests/:requestId/reject", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(registrationRoleRequestParamsSchema, request.params);
    const item = await rejectRegistrationRoleRequest(db, await operatingInvocation(db, auth, request), params.requestId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/users/:userId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(updateUserBodySchema, request.body);
    const item = await updateUserProfile(db, await operatingInvocation(db, auth, request), params.userId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/users/:userId/activation", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(updateUserActiveBodySchema, request.body);
    const item = await deactivateUser(db, await operatingInvocation(db, auth, request), params.userId, body, mutationContext(request));

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/users/:userId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    await deleteUser(db, await operatingInvocation(db, auth, request), params.userId, mutationContext(request));

    return { status: 204, body: null };
  });

  router.post("/api/v1/users/:userId/password", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(resetUserPasswordBodySchema, request.body);
    const item = await resetUserPassword(db, await operatingInvocation(db, auth, request), params.userId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.put("/api/v1/users/:userId/roles", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(replaceUserRolesBodySchema, request.body);
    const item = await replaceUserRoles(db, await operatingInvocation(db, auth, request), params.userId, body, mutationContext(request));

    return { status: 200, body: { item } };
  });

  router.put("/api/v1/users/:userId/organization-roles", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(userIdParamsSchema, request.params);
    const body = parseWithSchema(updateOrganizationRolesBodySchema, request.body);
    const item = await replaceOrganizationRoles(db, await operatingInvocation(db, auth, request), params.userId, body, mutationContext(request));

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/workflow-role-bindings", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectIdParamsSchema, request.params);
    const item = await getProjectRoleBindings(db, await operatingInvocation(db, auth, request), params.projectId);

    return { status: 200, body: item };
  });

  router.put("/api/v1/projects/:projectId/workflow-role-bindings/:userId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectUserParamsSchema, request.params);
    const body = parseWithSchema(updateProjectWorkflowRolesBodySchema, request.body);
    const item = await replaceProjectWorkflowRoles(db, await operatingInvocation(db, auth, request), params.projectId, params.userId, body, {
      requestId: request.requestId
    });

    return { status: 200, body: { item } };
  });
}
