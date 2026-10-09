import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type APIRequestContext } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  countCanonicalPlacementsForModule,
  getParameterModuleById,
  moveParameterModule
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
  expect(response.status(), await response.text()).toBe(410);
  expect(await response.json()).toMatchObject({ error: { code: "GONE", details: { reason: "legacy-surface-retired" } } });
  await withPgClient(async (client) => {
    const placed = await moveParameterModule(client, { organizationId, moduleId: placementModuleId, parentId: moduleId });
    expect(placed?.parentId).toBe(moduleId);
  });
  return placementModuleId;
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
    const placementModuleId = await assignBindingToModule(request, binding.bindingId, child.item.id);

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
        "The API-returned module tree identifies the canonical Binding in the parent subtree, but not its direct members. Driver-leaf positioning is a test-only fixture; legacy movement remains 410."
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
    await assignBindingToModule(request, binding.bindingId, child.item.id);

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
      notes: "The test-only fixture positions the driver leaf beneath a business child. The business-module move API reparents the subtree while preserving the canonical Binding's leaf; the cycle move returns 409."
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

  test("module tree mutations require admin and canonical driver deletion is retired without writes", async ({
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
    // A module is "non-empty" when a canonical Registration Placement points at it.
    const leaf = await createParameterModule(request, { name: leafName });
    await withPgClient(async (client) => {
      await client.query(
        `insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
         values ('modtree-authz-attr',$1,'driver-registration','ModTree battery info','compatible:huawei,batt_info')`,
        [organizationId]
      );
      await client.query(
        `insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
         values ('modtree-authz-attr','physical-device','multiple')`
      );
      await client.query(
        `insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
         values ('modtree-authz-driver',$1,$2,'modtree-authz-driver',1,'driver-group','curated','modtree-authz-attr')`,
        [organizationId, `${moduleNamePrefix}Authz Driver ${suffix}`]
      );
    });
    const catalogRelease = await withPgClient(async (client) => {
      const current = await client.query<{ id: string }>(
        "select current_catalog_release_id as id from parameter_catalog.catalog_state"
      );
      return current.rows[0]!.id;
    });
    const registration = await request.post(
      apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`),
      {
        headers: {
          ...adminHeaders(),
          "X-WiseEff-Catalog-Release": catalogRelease,
          "Idempotency-Key": `modtree-authz-${suffix}`
        },
        data: {
          subjectId: "csub_drv_huawei_batt_info",
          destinationModuleId: "modtree-authz-driver",
          placement: { mode: "use-default" }
        }
      }
    );
    expect(registration.status(), await registration.text()).toBe(201);
    const registrationId = (await registration.json()).item.id;
    const placementUrl = apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations/${registrationId}/placement`);
    const placementBefore = await request.get(placementUrl, { headers: adminHeaders() });
    expect(placementBefore.status(), await placementBefore.text()).toBe(200);
    const placement = (await placementBefore.json()).item;
    const modulesBefore = await request.get(apiRoute("/api/v1/parameter-modules"), { headers: adminHeaders() });
    expect(modulesBefore.status(), await modulesBefore.text()).toBe(200);
    const modules = (await modulesBefore.json()).items;

    const deleteParentResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${parent.item.id}`), {
      headers: adminHeaders()
    });
    expect(deleteParentResponse.status()).toBe(409);

    const deleteLeafResponse = await page.request.delete(apiRoute("/api/v1/parameter-modules/modtree-authz-driver"), {
      headers: adminHeaders()
    });
    expect(deleteLeafResponse.status(), await deleteLeafResponse.text()).toBe(410);
    expect(await deleteLeafResponse.json()).toMatchObject({ error: { code: "GONE", details: {
      reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false
    } } });
    const modulesAfter = await request.get(apiRoute("/api/v1/parameter-modules"), { headers: adminHeaders() });
    expect(modulesAfter.status(), await modulesAfter.text()).toBe(200);
    expect((await modulesAfter.json()).items).toEqual(modules);
    const placementAfter = await request.get(placementUrl, { headers: adminHeaders() });
    expect(placementAfter.status(), await placementAfter.text()).toBe(200);
    expect((await placementAfter.json()).item).toEqual(placement);
    const deleteEmptyLeafResponse = await page.request.delete(apiRoute(`/api/v1/parameter-modules/${leaf.item.id}`), {
      headers: adminHeaders()
    });
    expect(deleteEmptyLeafResponse.status(), await deleteEmptyLeafResponse.text()).toBeLessThan(300);

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
          path: "/api/v1/parameter-modules/modtree-authz-driver",
          responseSummary: "GONE; module tree and canonical Placement unchanged"
        })
      ],
      notes: "Non-admin module create returned 403; deleting a parent with children returned 409; canonical driver deletion returned 410 with no tree or Placement change; an empty taxonomy leaf could be deleted."
    });
  });
});
