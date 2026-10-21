import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type APIRequestContext } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  countCanonicalPlacementsForModule,
  getParameterModuleById
} from "../../server/modules/parameters/parameterModuleRepository";
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

async function assignBindingToModule(request: APIRequestContext, bindingId: string, moduleId: string) {
  const bindingsResponse = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
    headers: adminHeaders()
  });
  expect(bindingsResponse.status(), await bindingsResponse.text()).toBe(200);
  const bindings = (await bindingsResponse.json()).items as ParameterRecordDto[];
  const binding = bindings.find((item) => item.id === bindingId);
  expect(binding?.moduleId, "canonical Binding read model must expose its Placement module").toBeTruthy();
  const placementModuleId = binding!.moduleId!;
  const response = await request.post(apiRoute(`/api/v1/parameter-modules/${placementModuleId}/move`), {
    headers: adminHeaders(), data: { parentId: moduleId }
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.json()).toMatchObject({ item: { id: placementModuleId, parentId: moduleId } });
  await withPgClient(async (client) => {
    const placed = await getParameterModuleById(client, { organizationId, moduleId: placementModuleId });
    expect(placed?.parentId).toBe(moduleId);
    expect(await countCanonicalPlacementsForModule(client, { organizationId, moduleId: placementModuleId })).toBeGreaterThanOrEqual(1);
  });
  return { moduleId: placementModuleId, response };
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
    const { moduleId: placementModuleId, response: placementMoveResponse } = await assignBindingToModule(request, binding.bindingId, child.item.id);

    const listResponse = await page.request.get(
      apiRoute(
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings`
      ),
      { headers: adminHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: ParameterRecordDto[] };
    const matched = listBody.items.find((item) => item.id === binding.bindingId);
    expect(matched).toBeTruthy();
    expect(matched?.moduleId).toBe(placementModuleId);

    const treeResponse = await page.request.get(
      apiRoute("/api/v1/parameter-modules"),
      { headers: adminHeaders() }
    );
    expect(treeResponse.ok()).toBe(true);
    const treeBody = (await treeResponse.json()) as { items: ParameterModuleDto[] };
    const placementLeaf = treeBody.items.find((item) => item.id === placementModuleId);
    expect(placementLeaf).toMatchObject({ parentId: child.item.id, path: `${child.item.path}/${placementModuleId}` });
    const subtreeModuleIds = treeBody.items.filter((item) => item.path.startsWith(`${parent.item.path}/`)).map((item) => item.id);
    expect(listBody.items.filter((item) => subtreeModuleIds.includes(item.moduleId ?? "")).map((item) => item.id)).toContain(binding.bindingId);
    expect(listBody.items.filter((item) => item.moduleId === parent.item.id).map((item) => item.id)).not.toContain(binding.bindingId);

    const persisted = await withPgClient(async (client) => ({
      leaf: await getParameterModuleById(client, { organizationId, moduleId: placementModuleId }),
      placements: await countCanonicalPlacementsForModule(client, { organizationId, moduleId: placementModuleId })
    }));
    expect(persisted.leaf).toMatchObject({ parentId: child.item.id, path: `${child.item.path}/${placementModuleId}` });
    expect(Number(persisted.placements)).toBeGreaterThanOrEqual(1);

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
        summarizeApiResponse(placementMoveResponse, {
          method: "POST",
          path: `/api/v1/parameter-modules/${placementModuleId}/move`,
          responseSummary: `canonical driver leaf moved under ${child.item.id}`
        }),
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings`,
          responseSummary: `binding ${binding.bindingId}; moduleId=${placementModuleId}`
        }),
        summarizeApiResponse(treeResponse, {
          method: "GET",
          path: "/api/v1/parameter-modules",
          responseSummary: `leaf ${placementModuleId} beneath child ${child.item.id}`
        })
      ],
      db: [
        {
          table: "parameter_modules",
          predicate: `organization_id=${organizationId} and id=${placementModuleId}`,
          observed: `parent_id=${persisted.leaf?.parentId}; path=${persisted.leaf?.path}`,
          rowCount: persisted.leaf ? 1 : 0
        },
        {
          table: "parameter_catalog.subject_placements",
          predicate: `module_id=${placementModuleId}`,
          observed: `canonical placements=${persisted.placements}`,
          rowCount: Number(persisted.placements)
        }
      ],
      notes:
        "The admin move API positions the canonical driver leaf beneath the child. The API-returned tree and persisted Placement identify the Binding in the parent subtree, but not its direct members."
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
    const { moduleId: placementModuleId, response: placementMoveResponse } = await assignBindingToModule(request, binding.bindingId, child.item.id);

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
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings`
      ),
      { headers: adminHeaders() }
    );
    expect(listAfterMove.ok()).toBe(true);
    const listAfterMoveBody = (await listAfterMove.json()) as { items: ParameterRecordDto[] };
    expect(listAfterMoveBody.items.some((item) => item.id === binding.bindingId)).toBe(true);
    const treeAfterMove = await page.request.get(apiRoute("/api/v1/parameter-modules"), { headers: adminHeaders() });
    expect(treeAfterMove.status(), await treeAfterMove.text()).toBe(200);
    const placedModuleId = listAfterMoveBody.items.find((item) => item.id === binding.bindingId)!.moduleId;
    expect((await treeAfterMove.json()).items.find((item: ParameterModuleDto) => item.id === placedModuleId)).toMatchObject({
      parentId: child.item.id, path: `${moduleB.item.path}/${child.item.id}/${placedModuleId}`
    });

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
        summarizeApiResponse(placementMoveResponse, {
          method: "POST",
          path: `/api/v1/parameter-modules/${placementModuleId}/move`,
          responseSummary: `canonical driver leaf moved under ${child.item.id}`
        }),
        summarizeApiResponse(moveResponse, {
          method: "POST",
          path: `/api/v1/parameter-modules/${child.item.id}/move`,
          responseSummary: `parentId=${movedBody.item.parentId}`
        }),
        summarizeApiResponse(listAfterMove, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings`,
          responseSummary: `binding ${binding.bindingId} follows moved subtree under ${moduleB.item.id}`
        }),
        summarizeApiResponse(cycleResponse, {
          method: "POST",
          path: `/api/v1/parameter-modules/${moduleB.item.id}/move`,
          responseSummary: "CONFLICT cycle rejected"
        })
      ],
      notes: "The admin move API positions the driver leaf beneath a business child, then reparents the subtree while preserving the canonical Binding's leaf; the cycle move returns 409."
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

  test("module tree mutations require admin and deleting a canonical driver leaf unsets Placement while retaining values", async ({
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
    const binding = await seedAssignableBinding(request, "MOD-TREE-AUTHZ-001 populated canonical driver leaf");
    const target = await withPgClient(async (client) => {
      const rows = (await client.query<{ registration_id: string; module_id: string }>(
        `select binding.registration_id, placement.module_id
         from parameter_catalog.project_parameter_bindings binding
         join parameter_catalog.organization_subject_registrations registration
           on registration.id=binding.registration_id and registration.organization_id=binding.organization_id
         join parameter_catalog.subject_placements placement
           on placement.id=registration.current_placement_id and placement.registration_id=registration.id
         where binding.id=$1 and binding.organization_id=$2`,
        [binding.bindingId, organizationId]
      )).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.module_id).toBeTruthy();
      return rows[0]!;
    });
    const registrationId = target.registration_id;
    const driverModuleId = target.module_id;
    const canonicalSnapshot = () => withPgClient(async (client) => ({
      registration: (await client.query(
        "select * from parameter_catalog.organization_subject_registrations where id=$1 and organization_id=$2",
        [registrationId, organizationId]
      )).rows,
      bindings: (await client.query<{ id: string }>(
        "select * from parameter_catalog.project_parameter_bindings where registration_id=$1 and organization_id=$2 order by id",
        [registrationId, organizationId]
      )).rows,
      values: (await client.query(
        `select value.* from parameter_catalog.project_parameter_values value
         join parameter_catalog.project_parameter_bindings binding on binding.id=value.binding_id
         where binding.registration_id=$1 and binding.organization_id=$2 order by value.id`,
        [registrationId, organizationId]
      )).rows
    }));
    const canonicalBefore = await canonicalSnapshot();
    expect(canonicalBefore.registration).toHaveLength(1);
    expect(canonicalBefore.bindings.map(item => item.id)).toContain(binding.bindingId);
    expect(canonicalBefore.values.length).toBeGreaterThanOrEqual(1);
    const placementUrl = apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations/${registrationId}/placement`);
    const placementBefore = await request.get(placementUrl, { headers: adminHeaders() });
    expect(placementBefore.status(), await placementBefore.text()).toBe(200);
    const placement = (await placementBefore.json()).item;
    expect(placement.moduleId).toBe(driverModuleId);
    const modulesBefore = await request.get(apiRoute("/api/v1/parameter-modules"), { headers: adminHeaders() });
    expect(modulesBefore.status(), await modulesBefore.text()).toBe(200);
    const modules = (await modulesBefore.json()).items as ParameterModuleDto[];
    const deniedMove = await page.request.post(apiRoute(`/api/v1/parameter-modules/${driverModuleId}/move`), {
      headers: authHeadersForRole("hardware-user"), data: { parentId: parent.item.id }
    });
    expect(deniedMove.status(), await deniedMove.text()).toBe(403);
    const deniedDelete = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${driverModuleId}`), {
      headers: authHeadersForRole("hardware-user")
    });
    expect(deniedDelete.status(), await deniedDelete.text()).toBe(403);

    const deleteParentResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${parent.item.id}`), {
      headers: adminHeaders()
    });
    expect(deleteParentResponse.status()).toBe(409);

    const afterRefusals = await request.get(apiRoute("/api/v1/parameter-modules"), { headers: adminHeaders() });
    expect(afterRefusals.status(), await afterRefusals.text()).toBe(200);
    expect((await afterRefusals.json()).items).toEqual(modules);
    const placementAfterRefusals = await request.get(placementUrl, { headers: adminHeaders() });
    expect(placementAfterRefusals.status(), await placementAfterRefusals.text()).toBe(200);
    expect((await placementAfterRefusals.json()).item).toEqual(placement);
    expect(placementAfterRefusals.headers().etag).toBe(placementBefore.headers().etag);
    expect(await canonicalSnapshot()).toEqual(canonicalBefore);

    const deleteLeafResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${driverModuleId}`), {
      headers: adminHeaders()
    });
    expect(deleteLeafResponse.status(), await deleteLeafResponse.text()).toBe(204);
    const modulesAfter = await request.get(apiRoute("/api/v1/parameter-modules"), { headers: adminHeaders() });
    expect(modulesAfter.status(), await modulesAfter.text()).toBe(200);
    expect((await modulesAfter.json()).items).toEqual(modules.filter(item => item.id !== driverModuleId));
    const placementAfter = await request.get(placementUrl, { headers: adminHeaders() });
    expect(placementAfter.status(), await placementAfter.text()).toBe(200);
    const unsetPlacement = (await placementAfter.json()).item;
    expect(unsetPlacement.id).toBe(placement.id);
    expect(unsetPlacement.moduleId).toBeUndefined();
    expect(placementAfter.headers().etag).toBeTruthy();
    expect(placementAfter.headers().etag).not.toBe(placementBefore.headers().etag);
    const persisted = await withPgClient(async (client) => ({
      module: await getParameterModuleById(client, { organizationId, moduleId: driverModuleId }),
      placements: (await client.query<{ id: string; registration_id: string; module_id: string | null }>(
        "select id, registration_id, module_id from parameter_catalog.subject_placements where id=$1 and organization_id=$2",
        [placement.id, organizationId]
      )).rows
    }));
    expect(persisted.module).toBeNull();
    expect(persisted.placements).toEqual([{ id: placement.id, registration_id: registrationId, module_id: null }]);
    const canonicalAfter = await canonicalSnapshot();
    expect(canonicalAfter).toEqual(canonicalBefore);
    const bindingsAfterDelete = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
      headers: adminHeaders()
    });
    expect(bindingsAfterDelete.status(), await bindingsAfterDelete.text()).toBe(200);
    expect(((await bindingsAfterDelete.json()).items as ParameterRecordDto[]).map(item => item.id)).toContain(binding.bindingId);
    const deleteEmptyLeafResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${leaf.item.id}`), {
      headers: adminHeaders()
    });
    expect(deleteEmptyLeafResponse.status(), await deleteEmptyLeafResponse.text()).toBe(204);

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
        summarizeApiResponse(deniedMove, {
          method: "POST",
          path: `/api/v1/parameter-modules/${driverModuleId}/move`,
          responseSummary: "FORBIDDEN for non-admin"
        }),
        summarizeApiResponse(deniedDelete, {
          method: "DELETE",
          path: `/api/v1/parameter-modules/${driverModuleId}`,
          responseSummary: "FORBIDDEN for non-admin"
        }),
        summarizeApiResponse(deleteParentResponse, {
          method: "DELETE",
          path: `/api/v1/parameter-modules/${parent.item.id}`,
          responseSummary: "CONFLICT child modules remain"
        }),
        summarizeApiResponse(deleteLeafResponse, {
          method: "DELETE",
          path: `/api/v1/parameter-modules/${driverModuleId}`,
          responseSummary: "NO CONTENT; leaf deleted, retained Placement unset"
        }),
        summarizeApiResponse(placementAfter, {
          method: "GET",
          path: `/api/v2/organizations/${organizationId}/subject-registrations/${registrationId}/placement`,
          responseSummary: `Placement ${placement.id} retained without moduleId and with a new ETag`
        }),
        summarizeApiResponse(bindingsAfterDelete, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings`,
          responseSummary: `canonical Binding ${binding.bindingId} retained after leaf deletion`
        })
      ],
      db: [
        { table: "parameter_modules", predicate: `organization_id=${organizationId} and id=${driverModuleId}`,
          observed: "deleted", rowCount: 0 },
        { table: "parameter_catalog.subject_placements", predicate: `id=${placement.id}`,
          observed: `registration_id=${registrationId}; module_id=null`, rowCount: persisted.placements.length },
        { table: "parameter_catalog.project_parameter_bindings", predicate: `registration_id=${registrationId}`,
          observed: "all canonical Binding rows unchanged", rowCount: canonicalAfter.bindings.length },
        { table: "parameter_catalog.project_parameter_values", predicate: `binding.registration_id=${registrationId}`,
          observed: "all canonical value rows unchanged", rowCount: canonicalAfter.values.length }
      ],
      notes: "Non-admin module create, move and delete returned 403; deleting a parent with children returned 409. Admin deletion of a populated driver leaf returned 204, retained its Placement with module_id=null, and preserved every canonical Registration, Binding and value row. An empty taxonomy leaf also returned 204."
    });
  });
});
