import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import type { ArchiveObjectStore } from "../catalog-cutover/archive";
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
  getGovernedProjectMembers,
  updateGovernedProjectMember,
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
import { changeOrganizationLifecycleSchema } from "../contracts/dtoSchemas/platformOrganizations";
import { previewOrganizationDeletion } from "./organizationDeletion";
import { listOrganizationErasures, readOrganizationErasure, retryOrganizationErasure, startOrganizationErasure } from "./organizationErasure";
import { startOrganizationErasureSchema } from "../contracts/dtoSchemas/organizationDeletion";
import { changeOrganizationLifecycle } from "../auth/organizationLifecycle";
import { createPlatformOrganization, emergencyDisableAdministrator, getAdministratorRecovery, listPlatformOrganizations, recoverOrganizationAdministrator, requirePlatformOrganizationManager } from "./platformOrganizations";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";
import { listOrganizationTeams, mutateOrganizationTeam, teamMembersSchema, teamNameSchema } from "./teams";
import { updateProjectMemberBodySchema } from "../contracts/dtoSchemas/projectMembers";
import { acceptOrganizationInvitation, invitationAcceptSchema, invitationInputSchema, invitationTokenSchema, issueOrganizationInvitation, listOrganizationInvitations, readOrganizationInvitation, revokeOrganizationInvitation } from "./invitations";
import { authAttemptKey, createAuthAttemptLimiter } from "../auth/authAttemptLimiter";
import { listProjectHandovers, assignProjectHandover, projectHandoverBodySchema, projectHandoverParamsSchema } from "../parameters/handover";
import { parameterInvocation, parameterRequestAccess, withParameterAccess } from "../parameters/operatingScope";
import { previewAccountTransfer, transferAccount } from "./accountTransfer";
import { accountTransferRequestSchema, accountTransferTargetSchema } from "../contracts/dtoSchemas/accountTransfer";
import { getOrganizationWorkspaceSummary } from "./workspaceSummary";

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

function parseWithSchema<Schema extends z.ZodTypeAny>(schema: Schema, value: unknown, message = "Invalid user governance route input."): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }

  return parsed.data;
}

export function registerUserRoutes(
  router: WiseEffRouter,
  options: { db?: Database; objectStore?: ObjectStore; catalogArchiveStore?: ArchiveObjectStore; catalogArchiveKey?: string; localInvitationsEnabled?: boolean; selfRegisterEnabled?: boolean; registrationOrganizationId?: string; oidcIssuer?: string; authenticationProvider?: "local" | "oidc" | "hmac"; bridgeConnectionPool?: Pick<BridgeConnectionPool, "disconnect">; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  const mutationContext = (request: RouteRequest) => ({ requestId: request.requestId, authenticationProvider: options.authenticationProvider, oidcIssuer: options.oidcIssuer, bridgeConnectionPool: options.bridgeConnectionPool });
  const erasureContext = (request: RouteRequest) => ({ ...mutationContext(request), selfRegisterEnabled: options.selfRegisterEnabled,
    registrationOrganizationId: options.registrationOrganizationId, objectStore: options.objectStore, catalogArchiveStore: options.catalogArchiveStore, catalogArchiveKey: options.catalogArchiveKey });
  const operatingInvocation = (db: Database, auth: AuthContext, request: RouteRequest) => {
    const query = parseWithSchema(z.object({ organizationId: z.string().trim().min(1).max(200).optional() }), request.query);
    return query.organizationId === undefined ? createUserInvocation(auth) : resolveOperatingContext(db, createUserInvocation(auth), query.organizationId);
  };
  const invitationDb = () => {
    if (!options.localInvitationsEnabled) throw new ApiError("FORBIDDEN", "当前认证方式不支持本地密码邀请，请通过成员管理绑定外部身份。");
    return requireDb(options.db);
  };
  const invitationAttempts = createAuthAttemptLimiter();
  router.post("/api/v1/platform/organizations/:organizationId/members/:userId/transfer-preview", async request => {
    const db = requireDb(options.db), caller = createUserInvocation(await options.getCurrentAuthContext(request));
    const input = parseWithSchema(accountTransferTargetSchema, request.body);
    return { status: 200, body: { item: await previewAccountTransfer(db, caller, request.params.organizationId, request.params.userId, input.targetOrganizationId, mutationContext(request)) } };
  });
  router.post("/api/v1/platform/organizations/:organizationId/members/:userId/transfer", async request => {
    const db = requireDb(options.db), caller = createUserInvocation(await options.getCurrentAuthContext(request));
    const input = parseWithSchema(accountTransferRequestSchema, request.body);
    return { status: 200, body: { item: await transferAccount(db, caller, request.params.organizationId, request.params.userId, input, mutationContext(request)) } };
  });
  router.get("/api/v1/organization/project-handovers", async request => {
    const db = requireDb(options.db), auth = await parameterRequestAccess(db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    return { status: 200, body: await listProjectHandovers(db, auth) };
  });
  router.patch("/api/v1/organization/project-handovers/:kind/:id", async request => {
    const db = requireDb(options.db), invocation = createUserInvocation(await options.getCurrentAuthContext(request));
    const access = await parameterRequestAccess(db, invocation, request), auth = withParameterAccess(access, parameterInvocation(access) ?? invocation);
    const params = parseWithSchema(projectHandoverParamsSchema, request.params), body = parseWithSchema(projectHandoverBodySchema, request.body);
    await assignProjectHandover(db, auth, params.kind, params.id, body, request.requestId);
    return { status: 200, body: { ok: true } };
  });
  router.get("/api/v1/organization/invitations", async (request) => {
    const db = invitationDb(), auth = await options.getCurrentAuthContext(request);
    return { status: 200, body: { items: await listOrganizationInvitations(db, await operatingInvocation(db, auth, request)) } };
  });
  router.post("/api/v1/organization/invitations", async (request) => {
    const db = invitationDb(), auth = await options.getCurrentAuthContext(request), body = parseWithSchema(invitationInputSchema, request.body);
    return { status: 201, body: await issueOrganizationInvitation(db, await operatingInvocation(db, auth, request), body, request.requestId) };
  });
  router.post("/api/v1/organization/invitations/:invitationId/regenerate", async (request) => {
    const db = invitationDb(), auth = await options.getCurrentAuthContext(request), body = parseWithSchema(invitationInputSchema, request.body);
    return { status: 200, body: await issueOrganizationInvitation(db, await operatingInvocation(db, auth, request), body, request.requestId, request.params.invitationId) };
  });
  router.post("/api/v1/organization/invitations/:invitationId/revoke", async (request) => {
    const db = invitationDb(), auth = await options.getCurrentAuthContext(request);
    parseWithSchema(z.object({}).strict(), request.body);
    return { status: 200, body: { item: await revokeOrganizationInvitation(db, await operatingInvocation(db, auth, request), request.params.invitationId, request.requestId) } };
  });
  router.post("/api/v1/auth/invitations/preview", async (request) => {
    const db = invitationDb(), body = parseWithSchema(invitationTokenSchema, request.body);
    return { status: 200, body: { item: await readOrganizationInvitation(db, body.token) } };
  });
  router.post("/api/v1/auth/invitations/accept", async (request) => {
    const db = invitationDb(), body = parseWithSchema(invitationAcceptSchema.extend({ token: invitationTokenSchema.shape.token }), request.body);
    const decision = invitationAttempts.consume(authAttemptKey("register", request.clientIp ?? "unknown", body.username));
    if (!decision.allowed) throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试。", { retryAfterMs: decision.retryAfterMs });
    return { status: 201, body: await acceptOrganizationInvitation(db, body.token, body, request.requestId) };
  });
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
  router.get("/api/v1/platform/organization-deletions", async request => {
    const db = requireDb(options.db), caller = createUserInvocation(await options.getCurrentAuthContext(request));
    return { status: 200, body: { items: await listOrganizationErasures(db, caller) } };
  });
  router.get("/api/v1/platform/organization-deletions/:erasureId", async request => {
    const db = requireDb(options.db), caller = createUserInvocation(await options.getCurrentAuthContext(request));
    return { status: 200, body: { item: await readOrganizationErasure(db, caller, request.params.erasureId) } };
  });
  router.post("/api/v1/platform/organization-deletions/:erasureId/retry", async request => {
    const db = requireDb(options.db), caller = createUserInvocation(await options.getCurrentAuthContext(request));
    return { status: 200, body: { item: await retryOrganizationErasure(db, caller, request.params.erasureId, erasureContext(request)) } };
  });
  router.post("/api/v1/platform/organizations/:organizationId/deletions", async request => {
    const db = requireDb(options.db), caller = createUserInvocation(await options.getCurrentAuthContext(request));
    return { status: 202, body: { item: await startOrganizationErasure(db, caller, request.params.organizationId, parseWithSchema(startOrganizationErasureSchema, request.body), erasureContext(request)) } };
  });
  router.get("/api/v1/platform/organizations", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    requirePlatformOrganizationManager(auth);
    const query = parseWithSchema(z.object({ q: z.string().trim().max(200).optional() }).strict(), request.query);
    return { status: 200, body: { items: await listPlatformOrganizations(db, auth, query.q, undefined, mutationContext(request)) } };
  });
  router.get("/api/v1/platform/organizations/:organizationId/deletion-preview", async request => {
    const db = requireDb(options.db), actor = createUserInvocation(await options.getCurrentAuthContext(request));
    return { status: 200, body: { item: await previewOrganizationDeletion(db, actor, request.params.organizationId, {
      ...mutationContext(request), selfRegisterEnabled: options.selfRegisterEnabled, registrationOrganizationId: options.registrationOrganizationId
    }) } };
  });
  router.patch("/api/v1/platform/organizations/:organizationId/lifecycle", async request => {
    const db = requireDb(options.db), actor = await options.getCurrentAuthContext(request);
    return { status: 200, body: { item: await changeOrganizationLifecycle(db, createUserInvocation(actor), request.params.organizationId,
      parseWithSchema(changeOrganizationLifecycleSchema, request.body), request.requestId) } };
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

  router.get("/api/v1/organization/workspace-summary", async request => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    return { status: 200, body: { item: await getOrganizationWorkspaceSummary(db, await operatingInvocation(db, auth, request), Boolean(options.localInvitationsEnabled)) } };
  });

  router.get("/api/v1/organization/project-candidates", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    return { status: 200, body: { items: await listGovernedProjectCandidates(db, await operatingInvocation(db, auth, request)) } };
  });

  router.get("/api/v1/organization/teams", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    return { status: 200, body: { items: await listOrganizationTeams(db, await operatingInvocation(db, auth, request)) } };
  });
  router.post("/api/v1/organization/teams", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request), body = parseWithSchema(teamNameSchema, request.body);
    return { status: 201, body: { item: await mutateOrganizationTeam(db, await operatingInvocation(db, auth, request), request.requestId, { action: "create", ...body }) } };
  });
  router.patch("/api/v1/organization/teams/:teamId", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request), body = parseWithSchema(teamNameSchema, request.body);
    return { status: 200, body: { item: await mutateOrganizationTeam(db, await operatingInvocation(db, auth, request), request.requestId, { action: "rename", id: request.params.teamId, ...body }) } };
  });
  router.put("/api/v1/organization/teams/:teamId/members", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request), body = parseWithSchema(teamMembersSchema, request.body);
    return { status: 200, body: { item: await mutateOrganizationTeam(db, await operatingInvocation(db, auth, request), request.requestId, { action: "replace-members", id: request.params.teamId, ...body }) } };
  });
  router.delete("/api/v1/organization/teams/:teamId", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    await mutateOrganizationTeam(db, await operatingInvocation(db, auth, request), request.requestId, { action: "delete", id: request.params.teamId });
    return { status: 204, body: null };
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

  router.get("/api/v1/projects/:projectId/members", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    const { projectId } = parseWithSchema(projectIdParamsSchema, request.params);
    return { status: 200, body: await getGovernedProjectMembers(db, await operatingInvocation(db, auth, request), projectId) };
  });

  router.put("/api/v1/projects/:projectId/members/:userId", async (request) => {
    const db = requireDb(options.db), auth = await options.getCurrentAuthContext(request);
    const { projectId, userId } = parseWithSchema(projectUserParamsSchema, request.params);
    const body = parseWithSchema(updateProjectMemberBodySchema, request.body);
    return { status: 200, body: await updateGovernedProjectMember(db, await operatingInvocation(db, auth, request), projectId, userId, body, request.requestId) };
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
