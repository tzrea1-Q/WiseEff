import "dotenv/config";
import { expect, test, type APIRequestContext } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { authHeadersForRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { disposableRuntimeOutcomeFromTestInfo } from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import {
  seedIsolatedNumericCellBinding,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime,
  type IsolatedBinding
} from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const moduleNamePrefix = "Acceptance ModTree ";
const databaseUrl = process.env.DATABASE_URL;

test.skip(!databaseUrl, "DATABASE_URL is required for disposable post-cutover hierarchical module acceptance.");

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

function adminHeaders() {
  return authHeadersForRole("admin");
}

async function seedOrgHardwareUser() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, null, 'hardware-user')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [
        `acceptance-${acceptanceCast.zhaoHeng.userId}-hardware-user-org`,
        acceptanceCast.zhaoHeng.userId,
        organizationId
      ]
    );
  });
}

async function cleanupAcceptanceModuleRows() {
  await withPgClient(async (client) => {
    const parameterModuleIds = (
      await client.query<{ id: string }>(
        "select id from parameter_modules where organization_id = $1 and name like $2",
        [organizationId, `${moduleNamePrefix}%`]
      )
    ).rows.map((row) => row.id);

    if (parameterModuleIds.length > 0) {
      const unclassified = await client.query<{ id: string }>(
        `
        select id from parameter_modules
        where organization_id = $1 and parent_id is null and kind = 'unclassified'
        order by path
        limit 1
        `,
        [organizationId]
      );
      const fallbackModuleId = unclassified.rows[0]?.id;
      if (fallbackModuleId) {
        await client.query(
          `
          update project_parameter_bindings
          set module_id = $1
          where organization_id = $2
            and module_id = any($3::text[])
          `,
          [fallbackModuleId, organizationId, parameterModuleIds]
        );
      }
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

async function createParameterModule(
  request: APIRequestContext,
  input: { name: string; parentId?: string | null }
) {
  const response = await request.post(apiRoute("/api/v1/parameter-modules"), {
    headers: adminHeaders(),
    data: {
      name: input.name,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {})
    }
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { item: ParameterModuleDto };
  return { response, item: body.item };
}

async function createDebugModule(
  request: APIRequestContext,
  input: { name: string; parentId?: string | null }
) {
  const response = await request.post(apiRoute("/api/v1/debugging/admin/modules"), {
    headers: adminHeaders(),
    data: {
      name: input.name,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {})
    }
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { item: DebugModuleDto };
  return { response, item: body.item };
}

async function assignBindingToModule(bindingId: string, moduleId: string) {
  await withPgClient(async (client) => {
    const result = await client.query(
      `
      update project_parameter_bindings
      set module_id = $1
      where organization_id = $2 and id = $3
      `,
      [moduleId, organizationId, bindingId]
    );
    expect(result.rowCount).toBe(1);
  });
}

async function seedAssignableBinding(
  request: APIRequestContext,
  reason: string,
  propertyKey = "iin_max"
): Promise<IsolatedBinding> {
  return seedIsolatedNumericCellBinding(request, {
    projectId,
    propertyKey,
    cellValue: 2300,
    reason
  });
}

test.describe("MOD-TREE hierarchical module acceptance", () => {
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable hierarchical-modules database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "mod_tree",
      markerPurpose: "mod-tree"
    });
    restoreDisposable = started.restore;
    await seedOrgHardwareUser();
    await cleanupAcceptanceModuleRows();
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("nested parameter modules support subtree filtering for assigned parameters", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance MOD-TREE-PARAM-001
    // @operation MOD-TREE-PARAM-001
    const suffix = Date.now().toString(36);
    const parentName = `${moduleNamePrefix}Power ${suffix}`;
    const childName = `${moduleNamePrefix}Battery ${suffix}`;

    const parent = await createParameterModule(request, { name: parentName });
    const child = await createParameterModule(request, { name: childName, parentId: parent.item.id });
    expect(child.item.parentId).toBe(parent.item.id);
    expect(child.item.path).toBe(`${parent.item.path}/${child.item.id}`);

    const binding = await seedAssignableBinding(request, "MOD-TREE-PARAM-001 semantic binding");
    await assignBindingToModule(binding.bindingId, child.item.id);

    const listResponse = await page.request.get(
      apiRoute(
        `/api/v1/parameters?projectId=${encodeURIComponent(projectId)}&moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=true`
      ),
      { headers: adminHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: ParameterRecordDto[] };
    const matched = listBody.items.find((item) => item.id === binding.bindingId);
    expect(matched).toBeTruthy();
    expect(matched?.moduleId).toBe(child.item.id);

    const directOnlyResponse = await page.request.get(
      apiRoute(
        `/api/v1/parameters?projectId=${encodeURIComponent(projectId)}&moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=false`
      ),
      { headers: adminHeaders() }
    );
    expect(directOnlyResponse.ok()).toBe(true);
    const directOnlyBody = (await directOnlyResponse.json()) as { items: ParameterRecordDto[] };
    expect(directOnlyBody.items.some((item) => item.id === binding.bindingId)).toBe(false);

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
          responseSummary: `subtree includes binding ${binding.bindingId}`
        })
      ],
      db: [
        {
          table: "project_parameter_bindings",
          predicate: `id=${binding.bindingId}`,
          observed: `module_id=${child.item.id}`,
          rowCount: 1
        }
      ],
      notes:
        "Parent module filter with includeDescendants=true returned a post-cutover binding assigned to a child module (TD-079)."
    });
  });

  test("admin can move parameter modules and cycle moves are rejected", async ({ page, request }, testInfo) => {
    // @acceptance MOD-TREE-PARAM-002
    // @operation MOD-TREE-PARAM-002
    const suffix = Date.now().toString(36);
    const moduleA = await createParameterModule(request, { name: `${moduleNamePrefix}Move A ${suffix}` });
    const moduleB = await createParameterModule(request, { name: `${moduleNamePrefix}Move B ${suffix}` });
    const child = await createParameterModule(request, {
      name: `${moduleNamePrefix}Move Child ${suffix}`,
      parentId: moduleA.item.id
    });

    const binding = await seedAssignableBinding(request, "MOD-TREE-PARAM-002 semantic binding", "iin_min");
    await assignBindingToModule(binding.bindingId, child.item.id);

    const moveResponse = await page.request.post(apiRoute(`/api/v1/parameter-modules/${child.item.id}/move`), {
      headers: adminHeaders(),
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
      { headers: adminHeaders() }
    );
    expect(listAfterMove.ok()).toBe(true);
    const listAfterMoveBody = (await listAfterMove.json()) as { items: ParameterRecordDto[] };
    expect(listAfterMoveBody.items.some((item) => item.id === binding.bindingId)).toBe(true);

    const cycleResponse = await page.request.post(apiRoute(`/api/v1/parameter-modules/${moduleB.item.id}/move`), {
      headers: adminHeaders(),
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
          responseSummary: `binding ${binding.bindingId} follows moved subtree under ${moduleB.item.id}`
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

  test("nested debug node modules support subtree filtering for assigned nodes", async ({ page, request }, testInfo) => {
    // @acceptance MOD-TREE-DEBUG-001
    // @operation MOD-TREE-DEBUG-001
    const suffix = Date.now().toString(36);
    const parent = await createDebugModule(request, { name: `${moduleNamePrefix}Debug Root ${suffix}` });
    const child = await createDebugModule(request, {
      name: `${moduleNamePrefix}Debug Child ${suffix}`,
      parentId: parent.item.id
    });
    const nodeName = `${moduleNamePrefix}Node ${suffix}`;

    const createNodeResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/nodes"), {
      headers: adminHeaders(),
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
      { headers: adminHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: DebugNodeDto[] };
    expect(listBody.items.some((item) => item.id === createNodeBody.item.id)).toBe(true);

    const directOnlyResponse = await page.request.get(
      apiRoute(
        `/api/v1/debugging/admin/nodes?moduleId=${encodeURIComponent(parent.item.id)}&includeDescendants=false`
      ),
      { headers: adminHeaders() }
    );
    expect(directOnlyResponse.ok()).toBe(true);
    const directOnlyBody = (await directOnlyResponse.json()) as { items: DebugNodeDto[] };
    expect(directOnlyBody.items.some((item) => item.id === createNodeBody.item.id)).toBe(false);

    await recordOperationEvidence({
      operationId: "MOD-TREE-DEBUG-001",
      title: "nested debug module subtree filter",
      status: "passed",
      role: "Admin",
      route: "/debugging-admin/nodes",
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

  test("module tree mutations require admin and non-empty modules cannot be deleted", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance MOD-TREE-AUTHZ-001
    // @operation MOD-TREE-AUTHZ-001
    const suffix = Date.now().toString(36);
    const parentName = `${moduleNamePrefix}Authz Parent ${suffix}`;
    const childName = `${moduleNamePrefix}Authz Child ${suffix}`;
    const leafName = `${moduleNamePrefix}Authz Leaf ${suffix}`;

    const deniedCreate = await page.request.post(apiRoute("/api/v1/parameter-modules"), {
      headers: authHeadersForRole("hardware-user"),
      data: { name: `${moduleNamePrefix}Denied ${suffix}` }
    });
    expect(deniedCreate.status()).toBe(403);

    const parent = await createParameterModule(request, { name: parentName });
    await createParameterModule(request, { name: childName, parentId: parent.item.id });
    const leaf = await createParameterModule(request, { name: leafName });
    const binding = await seedAssignableBinding(request, "MOD-TREE-AUTHZ-001 semantic binding", "ichg_max");
    await assignBindingToModule(binding.bindingId, leaf.item.id);

    const deleteParentResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${parent.item.id}`), {
      headers: adminHeaders()
    });
    expect(deleteParentResponse.status()).toBe(409);

    const deleteLeafResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${leaf.item.id}`), {
      headers: adminHeaders()
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
          responseSummary: "CONFLICT bindings remain"
        })
      ],
      notes: "Non-admin module create returned 403; deleting modules with child modules or assigned bindings returned 409."
    });
  });
});
