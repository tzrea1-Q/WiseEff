import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { authHeadersForUser } from "./helpers/bearerAuth";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const acceptanceParameterDefinitionId = "fast-charge-current";
const acceptanceParameterListId = "aurora-fast-charge-current";
const hardwareUserId = "acceptance-modtree-hardware-user";
const hardwareRoleBindingId = "acceptance-modtree-hardware-user-binding";
const moduleNamePrefix = "Acceptance ModTree ";

type ParameterModuleDto = {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  depth: number;
};

type DebugModuleDto = ParameterModuleDto;

type ParameterRecordDto = {
  id: string;
  moduleId?: string | null;
};

type DebugNodeDto = {
  id: string;
  name: string;
  moduleId?: string | null;
};

function runSeedScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error([`npm run ${script} failed with exit code ${result.status}.`, stdout, stderr].filter(Boolean).join("\n"));
  }
}

function authHeaders(userId?: string) {
  if (userId === hardwareUserId) {
    return authHeadersForUser(hardwareUserId, "modtree.acceptance@chargelab.cn", "ModTree Acceptance Hardware User");
  }
  return smokeHeaders();
}

async function seedHardwareUser() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, 'ModTree Acceptance Hardware User', 'modtree.acceptance@chargelab.cn', 'Hardware User', true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [hardwareUserId, organizationId]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, null, 'hardware-user')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [hardwareRoleBindingId, hardwareUserId, organizationId]
    );
  });
}

async function cleanupAcceptanceModuleRows() {
  await withPgClient(async (client) => {
    await client.query(
      `
      update parameter_definitions
      set parameter_module_id = null
      where organization_id = $1
        and id = $2
        and parameter_module_id in (
          select id from parameter_modules
          where organization_id = $1 and name like $3
        )
      `,
      [organizationId, acceptanceParameterDefinitionId, `${moduleNamePrefix}%`]
    );

    const parameterModuleIds = (
      await client.query<{ id: string }>(
        "select id from parameter_modules where organization_id = $1 and name like $2",
        [organizationId, `${moduleNamePrefix}%`]
      )
    ).rows.map((row) => row.id);

    if (parameterModuleIds.length > 0) {
      await client.query("delete from parameter_modules where id = any($1::text[])", [parameterModuleIds]);
    }

    const debugModuleIds = (
      await client.query<{ id: string }>(
        "select id from debug_node_modules where organization_id = $1 and name like $2",
        [organizationId, `${moduleNamePrefix}%`]
      )
    ).rows.map((row) => row.id);

    if (debugModuleIds.length > 0) {
      await client.query(
        "delete from debug_nodes where organization_id = $1 and debug_node_module_id = any($2::text[])",
        [organizationId, debugModuleIds]
      );
      await client.query("delete from debug_node_modules where id = any($1::text[])", [debugModuleIds]);
    }
  });
}

async function prepareHierarchicalModulesAcceptanceState() {
  runSeedScript("db:migrate");
  runSeedScript("db:seed:m0");
  runSeedScript("db:seed:m1");
  runSeedScript("db:seed:m3");
  await seedHardwareUser();
  await cleanupAcceptanceModuleRows();
}

async function createParameterModule(
  request: APIRequestContext,
  input: { name: string; parentId?: string | null }
) {
  const response = await request.post(apiRoute("/api/v1/parameter-modules"), {
    headers: smokeHeaders(),
    data: {
      name: input.name,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {})
    }
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { item: ParameterModuleDto };
  return { response, item: body.item };
}

async function createDebugModule(
  request: APIRequestContext,
  input: { name: string; parentId?: string | null }
) {
  const response = await request.post(apiRoute("/api/v1/debugging/admin/modules"), {
    headers: smokeHeaders(),
    data: {
      name: input.name,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {})
    }
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { item: DebugModuleDto };
  return { response, item: body.item };
}

async function assignParameterToModule(moduleId: string) {
  await withPgClient(async (client) => {
    const result = await client.query(
      `
      update parameter_definitions
      set parameter_module_id = $1, updated_at = now()
      where organization_id = $2 and id = $3
      `,
      [moduleId, organizationId, acceptanceParameterDefinitionId]
    );
    expect(result.rowCount).toBe(1);
  });
}

test.describe("MOD-TREE hierarchical module acceptance", () => {
  test.beforeAll(async () => {
    await prepareHierarchicalModulesAcceptanceState();
  });

  test.afterAll(async () => {
    await cleanupAcceptanceModuleRows();
  });

  test("nested parameter modules support subtree filtering for assigned parameters", async ({ page }, testInfo) => {
    // @acceptance MOD-TREE-PARAM-001
    // @operation MOD-TREE-PARAM-001
    const suffix = Date.now().toString(36);
    const parentName = `${moduleNamePrefix}Power ${suffix}`;
    const childName = `${moduleNamePrefix}Battery ${suffix}`;

    const parent = await createParameterModule(page.request, { name: parentName });
    const child = await createParameterModule(page.request, { name: childName, parentId: parent.item.id });
    expect(child.item.parentId).toBe(parent.item.id);
    expect(child.item.path).toBe(`${parent.item.path}/${child.item.id}`);

    await assignParameterToModule(child.item.id);

    const listResponse = await page.request.get(
      apiRoute(
        `/api/v1/parameters?projectId=${encodeURIComponent(projectId)}&moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=true`
      ),
      { headers: smokeHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: ParameterRecordDto[] };
    const matched = listBody.items.find((item) => item.id === acceptanceParameterListId);
    expect(matched).toBeTruthy();
    expect(matched?.moduleId).toBe(child.item.id);

    const directOnlyResponse = await page.request.get(
      apiRoute(
        `/api/v1/parameters?projectId=${encodeURIComponent(projectId)}&moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=false`
      ),
      { headers: smokeHeaders() }
    );
    expect(directOnlyResponse.ok()).toBe(true);
    const directOnlyBody = (await directOnlyResponse.json()) as { items: ParameterRecordDto[] };
    expect(directOnlyBody.items.some((item) => item.id === acceptanceParameterListId)).toBe(false);

    await recordOperationEvidence({
      operationId: "MOD-TREE-PARAM-001",
      title: "nested parameter module subtree filter",
      status: "passed",
      role: "Admin",
      route: "/parameter-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(parent.response, {
          method: "POST",
          path: "/api/v1/parameter-modules",
          responseSummary: `parent=${parent.item.id}`
        }),
        summarizeApiResponse(child.response, {
          method: "POST",
          path: "/api/v1/parameter-modules",
          responseSummary: `child=${child.item.id}; parentId=${child.item.parentId}`
        }),
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/parameters",
          responseSummary: `subtree includes ${acceptanceParameterListId}`
        })
      ],
      db: [
        {
          table: "parameter_definitions",
          predicate: `id=${acceptanceParameterDefinitionId}`,
          observed: `parameter_module_id=${child.item.id}`,
          rowCount: 1
        }
      ],
      notes: "Parent module filter with includeDescendants=true returned a parameter assigned to a child module."
    });
  });

  test("admin can move parameter modules and cycle moves are rejected", async ({ page }, testInfo) => {
    // @acceptance MOD-TREE-PARAM-002
    // @operation MOD-TREE-PARAM-002
    const suffix = Date.now().toString(36);
    const moduleA = await createParameterModule(page.request, { name: `${moduleNamePrefix}Move A ${suffix}` });
    const moduleB = await createParameterModule(page.request, { name: `${moduleNamePrefix}Move B ${suffix}` });
    const child = await createParameterModule(page.request, {
      name: `${moduleNamePrefix}Move Child ${suffix}`,
      parentId: moduleA.item.id
    });

    await assignParameterToModule(child.item.id);

    const moveResponse = await page.request.post(apiRoute(`/api/v1/parameter-modules/${child.item.id}/move`), {
      headers: smokeHeaders(),
      data: { parentId: moduleB.item.id }
    });
    expect(moveResponse.ok()).toBe(true);
    const movedBody = (await moveResponse.json()) as { item: ParameterModuleDto };
    expect(movedBody.item.parentId).toBe(moduleB.item.id);
    expect(movedBody.item.path).toBe(`${moduleB.item.path}/${child.item.id}`);

    const listAfterMove = await page.request.get(
      apiRoute(
        `/api/v1/parameters?projectId=${encodeURIComponent(projectId)}&moduleId=${encodeURIComponent(moduleB.item.id)}&includeDescendants=true`
      ),
      { headers: smokeHeaders() }
    );
    expect(listAfterMove.ok()).toBe(true);
    const listAfterMoveBody = (await listAfterMove.json()) as { items: ParameterRecordDto[] };
    expect(listAfterMoveBody.items.some((item) => item.id === acceptanceParameterListId)).toBe(true);

    const cycleResponse = await page.request.post(apiRoute(`/api/v1/parameter-modules/${moduleB.item.id}/move`), {
      headers: smokeHeaders(),
      data: { parentId: child.item.id }
    });
    expect(cycleResponse.status()).toBe(409);
    const cycleBody = (await cycleResponse.json()) as { error?: { code?: string } };
    expect(cycleBody.error?.code).toBe("CONFLICT");

    await recordOperationEvidence({
      operationId: "MOD-TREE-PARAM-002",
      title: "parameter module move and cycle guard",
      status: "passed",
      role: "Admin",
      route: "/parameter-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(moveResponse, {
          method: "POST",
          path: `/api/v1/parameter-modules/${child.item.id}/move`,
          responseSummary: `parentId=${movedBody.item.parentId}`
        }),
        summarizeApiResponse(listAfterMove, {
          method: "GET",
          path: "/api/v1/parameters",
          responseSummary: `parameter follows moved subtree under ${moduleB.item.id}`
        }),
        summarizeApiResponse(cycleResponse, {
          method: "POST",
          path: `/api/v1/parameter-modules/${moduleB.item.id}/move`,
          responseSummary: "CONFLICT cycle rejected"
        })
      ],
      notes: "Moving a child module reparented it under a new root and subtree filtering followed; cycle move returned 409."
    });
  });

  test("nested debug node modules support subtree filtering for assigned nodes", async ({ page }, testInfo) => {
    // @acceptance MOD-TREE-DEBUG-001
    // @operation MOD-TREE-DEBUG-001
    const suffix = Date.now().toString(36);
    const parent = await createDebugModule(page.request, { name: `${moduleNamePrefix}Debug Root ${suffix}` });
    const child = await createDebugModule(page.request, {
      name: `${moduleNamePrefix}Debug Child ${suffix}`,
      parentId: parent.item.id
    });
    const nodeName = `${moduleNamePrefix}Node ${suffix}`;

    const createNodeResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/nodes"), {
      headers: smokeHeaders(),
      data: {
        name: nodeName,
        moduleId: child.item.id,
        bindings: [{ protocol: "hdc", nodePath: `/tmp/wiseeff/modtree/${suffix}`, accessMode: "RW", enabled: true }]
      }
    });
    expect(createNodeResponse.status()).toBe(201);
    const createNodeBody = (await createNodeResponse.json()) as { item: DebugNodeDto };
    expect(createNodeBody.item.moduleId).toBe(child.item.id);

    const listResponse = await page.request.get(
      apiRoute(
        `/api/v1/debugging/admin/nodes?moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=true`
      ),
      { headers: smokeHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: DebugNodeDto[] };
    expect(listBody.items.some((item) => item.id === createNodeBody.item.id)).toBe(true);

    const directOnlyResponse = await page.request.get(
      apiRoute(
        `/api/v1/debugging/admin/nodes?moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=false`
      ),
      { headers: smokeHeaders() }
    );
    expect(directOnlyResponse.ok()).toBe(true);
    const directOnlyBody = (await directOnlyResponse.json()) as { items: DebugNodeDto[] };
    expect(directOnlyBody.items.some((item) => item.id === createNodeBody.item.id)).toBe(false);

    await recordOperationEvidence({
      operationId: "MOD-TREE-DEBUG-001",
      title: "nested debug module subtree filter",
      status: "passed",
      role: "Admin",
      route: "/debugging-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(createNodeResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/nodes",
          responseSummary: `node=${createNodeBody.item.id}; moduleId=${child.item.id}`
        }),
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/nodes",
          responseSummary: `parent filter includes child node ${createNodeBody.item.id}`
        })
      ],
      notes: "Debug node library filter by parent module returned nodes assigned to a child module when includeDescendants=true."
    });
  });

  test("module tree mutations require admin and non-empty modules cannot be deleted", async ({ page }, testInfo) => {
    // @acceptance MOD-TREE-AUTHZ-001
    // @operation MOD-TREE-AUTHZ-001
    const suffix = Date.now().toString(36);
    const parentName = `${moduleNamePrefix}Authz Parent ${suffix}`;
    const childName = `${moduleNamePrefix}Authz Child ${suffix}`;
    const leafName = `${moduleNamePrefix}Authz Leaf ${suffix}`;

    const deniedCreate = await page.request.post(apiRoute("/api/v1/parameter-modules"), {
      headers: authHeaders(hardwareUserId),
      data: { name: `${moduleNamePrefix}Denied ${suffix}` }
    });
    expect(deniedCreate.status()).toBe(403);

    const parent = await createParameterModule(page.request, { name: parentName });
    await createParameterModule(page.request, { name: childName, parentId: parent.item.id });
    const leaf = await createParameterModule(page.request, { name: leafName });
    await assignParameterToModule(leaf.item.id);

    const deleteParentResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${parent.item.id}`), {
      headers: smokeHeaders()
    });
    expect(deleteParentResponse.status()).toBe(409);

    const deleteLeafResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${leaf.item.id}`), {
      headers: smokeHeaders()
    });
    expect(deleteLeafResponse.status()).toBe(409);

    await recordOperationEvidence({
      operationId: "MOD-TREE-AUTHZ-001",
      title: "module tree authz and delete guards",
      status: "passed",
      role: "Hardware User",
      route: "/parameter-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(deniedCreate, {
          method: "POST",
          path: "/api/v1/parameter-modules",
          responseSummary: "FORBIDDEN for non-admin"
        }),
        summarizeApiResponse(deleteParentResponse, {
          method: "DELETE",
          path: `/api/v1/parameter-modules/${parent.item.id}`,
          responseSummary: "CONFLICT child modules remain"
        }),
        summarizeApiResponse(deleteLeafResponse, {
          method: "DELETE",
          path: `/api/v1/parameter-modules/${leaf.item.id}`,
          responseSummary: "CONFLICT parameters remain"
        })
      ],
      notes: "Non-admin module create returned 403; deleting modules with child modules or assigned parameters returned 409."
    });
  });
});
