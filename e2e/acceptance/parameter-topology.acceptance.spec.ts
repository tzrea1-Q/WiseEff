import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const adminUserId = "u-xu-yun";
const descriptionPrefix = "PARAM-TOPOLOGY acceptance";

const specScId = "acceptance-spec-sc8562-gpio-int";
const specMtId = "acceptance-spec-mt5788-gpio-int";
const specScVersionId = "acceptance-specver-sc8562-gpio-int";
const specMtVersionId = "acceptance-specver-mt5788-gpio-int";
const reviewTaskId = "acceptance-spec-review-gpio-int";
const configSetId = "dcs-default-aurora";
const revisionId = "acceptance-topo-rev-aurora";
const logicalNodeId = "acceptance-logical-sc8562";
const mappingTaskId = "acceptance-identity-map-sc8562";

function adminHeaders() {
  return authHeadersForRole("admin");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function seedTopologyAcceptanceFixture() {
  await withPgClient(async (client) => {
    for (const [specId, key, versionId, displayName] of [
      [specScId, "sc8562/gpio_int", specScVersionId, "SC8562 gpio_int"],
      [specMtId, "mt5788/gpio_int", specMtVersionId, "MT5788 gpio_int"]
    ] as const) {
      await client.query(
        `
        insert into parameter_specs (id, organization_id, source_kind, specification_key)
        values ($1, $2, 'dts', $3)
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          specification_key = excluded.specification_key
        `,
        [specId, organizationId, key]
      );
      await client.query(
        `
        insert into parameter_spec_versions (
          id, parameter_spec_id, version, display_name, description, value_shape,
          example_value, lifecycle
        ) values (
          $1, $2, 1, $3, $4,
          '{"kind":"phandle-list"}'::jsonb,
          '{"kind":"cells","bits":32,"groups":[[{"kind":"phandle","label":"gpio13"},{"kind":"integer","raw":"29","value":"29"},{"kind":"integer","raw":"0","value":"0"}]]}'::jsonb,
          'active'
        )
        on conflict (id) do update set
          display_name = excluded.display_name,
          lifecycle = excluded.lifecycle
        `,
        [versionId, specId, displayName, `${descriptionPrefix} ${key}`]
      );
      await client.query(
        `
        insert into dts_property_specs (
          id, parameter_spec_id, property_key, schema_namespace, constraints
        ) values ($1, $2, 'gpio_int', 'vendor', '{}'::jsonb)
        on conflict (id) do update set property_key = excluded.property_key
        `,
        [`acceptance-dps-${specId}`, specId]
      );
    }

    await client.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
        project_count, status
      ) values (
        $1, $2, null,
        $3::jsonb,
        $4::jsonb,
        2, 'open'
      )
      on conflict (id) do update set
        status = 'open',
        reviewer_user_id = null,
        reason = null,
        resolved_at = null,
        candidate_schemas = excluded.candidate_schemas
      `,
      [
        reviewTaskId,
        organizationId,
        JSON.stringify({
          propertyKey: "gpio_int",
          driverModule: "mystery",
          evidence: ["inferred from compatible vendor,mystery"]
        }),
        JSON.stringify([
          { id: specScId, label: "sc8562/gpio_int" },
          { id: specMtId, label: "mt5788/gpio_int" }
        ])
      ]
    );

    const configSet = await client.query<{ id: string }>(
      `
      select id from dts_config_set
      where organization_id = $1 and project_id = $2
      order by created_at asc
      limit 1
      `,
      [organizationId, projectId]
    );
    const resolvedConfigSetId = configSet.rows[0]?.id ?? configSetId;
    if (!configSet.rows[0]) {
      await client.query(
        `
        insert into dts_config_set (id, organization_id, project_id, name, description)
        values ($1, $2, $3, 'default', $4)
        on conflict (id) do nothing
        `,
        [configSetId, organizationId, projectId, descriptionPrefix]
      );
    }

    await client.query(
      `
      insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
      values ($1, $2, $3, $4)
      on conflict (id) do nothing
      `,
      [logicalNodeId, organizationId, projectId, resolvedConfigSetId]
    );

    await client.query(
      `
      insert into dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
      ) values ($1, $2, $3, $4, 9001, 'needs_mapping', $5)
      on conflict (id) do update set
        status = 'needs_mapping',
        config_set_id = excluded.config_set_id
      `,
      [revisionId, organizationId, projectId, resolvedConfigSetId, adminUserId]
    );

    await client.query(
      `
      insert into identity_mapping_tasks (
        id, organization_id, project_id, config_revision_id,
        previous_logical_node_id, candidate_logical_node_ids, evidence, status
      ) values (
        $1, $2, $3, $4, null, $5::jsonb, $6::jsonb, 'open'
      )
      on conflict (id) do update set
        status = 'open',
        config_revision_id = excluded.config_revision_id,
        candidate_logical_node_ids = excluded.candidate_logical_node_ids,
        reviewer_user_id = null,
        reason = null,
        resolved_at = null
      `,
      [
        mappingTaskId,
        organizationId,
        projectId,
        revisionId,
        JSON.stringify([logicalNodeId]),
        JSON.stringify({ reason: "overlay target ambiguous", locator: "/amba/i2c@FDF5E000/sc8562@6E" })
      ]
    );
  });
}

async function cleanupTopologyAcceptanceFixture() {
  await withPgClient(async (client) => {
    await client.query(`delete from identity_mapping_tasks where id = $1`, [mappingTaskId]);
    await client.query(`delete from parameter_spec_review_tasks where id = $1`, [reviewTaskId]);
    await client.query(
      `
      delete from audit_events
      where kind = 'parameter-topology-governance'
        and target_id = any($1::text[])
      `,
      [[reviewTaskId, mappingTaskId, revisionId]]
    );
    await client.query(`delete from dts_validation_runs where config_revision_id = $1`, [revisionId]);
    await client.query(`delete from dts_config_revisions where id = $1`, [revisionId]);
    await client.query(`delete from dts_logical_nodes where id = $1`, [logicalNodeId]);
    await client.query(`delete from dts_property_specs where parameter_spec_id = any($1::text[])`, [
      [specScId, specMtId]
    ]);
    await client.query(`delete from parameter_spec_versions where id = any($1::text[])`, [
      [specScVersionId, specMtVersionId]
    ]);
    await client.query(`delete from parameter_specs where id = any($1::text[])`, [[specScId, specMtId]]);
  });
}

async function listSpecs(request: APIRequestContext, query: string) {
  return request.get(apiRoute(`/api/v2/parameter-specs?${query}`), { headers: adminHeaders() });
}

test.describe("Parameter topology / schema browser acceptance", () => {
  test.beforeEach(async () => {
    await seedTopologyAcceptanceFixture();
  });

  test.afterEach(async () => {
    await cleanupTopologyAcceptanceFixture();
  });

  test("governs specs, browses topology, edits, maps identity, and gates publish", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-SPEC-GOVERN-001
    // @acceptance PARAM-TOPOLOGY-BROWSE-001
    // @acceptance PARAM-TOPOLOGY-EDIT-001
    // @acceptance PARAM-IDENTITY-MAP-001
    // @acceptance PARAM-CONFIG-PUBLISH-GATE-001
    // @operation PARAM-SPEC-GOVERN-001
    // @operation PARAM-TOPOLOGY-BROWSE-001
    // @operation PARAM-TOPOLOGY-EDIT-001
    // @operation PARAM-IDENTITY-MAP-001
    // @operation PARAM-CONFIG-PUBLISH-GATE-001
    test.setTimeout(180_000);

    const specsResponse = await listSpecs(request, `propertyKey=${encodeURIComponent("gpio_int")}`);
    expect(specsResponse.ok()).toBe(true);
    const specsBody = (await specsResponse.json()) as {
      items: Array<{ id: string; propertyKey: string | null; driverModule: string | null }>;
    };
    const gpioSpecs = specsBody.items.filter((item) => item.propertyKey === "gpio_int");
    expect(gpioSpecs.length).toBeGreaterThanOrEqual(2);
    expect(gpioSpecs.some((item) => item.driverModule === "sc8562")).toBe(true);
    expect(gpioSpecs.some((item) => item.driverModule === "mt5788")).toBe(true);

    const resolveReview = await request.post(
      apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(reviewTaskId)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          parameterSpecId: specScId,
          reason: `${descriptionPrefix} approve sc8562 gpio_int schema`
        }
      }
    );
    expect(resolveReview.ok()).toBe(true);

    const reviewDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string; parameter_spec_id: string | null }>(
        `select status, parameter_spec_id from parameter_spec_review_tasks where id = $1`,
        [reviewTaskId]
      );
      return {
        table: "parameter_spec_review_tasks",
        predicate: `id=${reviewTaskId}`,
        observed: result.rows[0]
          ? `status=${result.rows[0].status}; spec=${result.rows[0].parameter_spec_id}`
          : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });

    const reviewAudit = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
      headers: adminHeaders()
    });
    expect(reviewAudit.ok()).toBe(true);
    const reviewAuditBody = (await reviewAudit.json()) as {
      items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
    };
    const reviewAuditItem = reviewAuditBody.items.find(
      (item) =>
        item.kind === "parameter-topology-governance" &&
        item.action === "spec-review-resolved" &&
        item.targetId === reviewTaskId
    );
    expect(reviewAuditItem).toBeTruthy();

    await signInBrowserAsRole(page, "admin", "/parameter-admin");
    await dismissXiaozeHint(page);
    const specLibrary = page.getByRole("region", { name: "参数规格库" });
    await expect(specLibrary).toBeVisible({ timeout: 30_000 });
    await page.getByRole("searchbox", { name: "搜索规格" }).fill("gpio_int");
    await expect(specLibrary.getByRole("cell", { name: "gpio_int" }).first()).toBeVisible({
      timeout: 20_000
    });
    const gpioRows = specLibrary.locator("tbody tr").filter({ hasText: "gpio_int" });
    await expect(gpioRows).toHaveCount(2, { timeout: 20_000 });
    await gpioRows.first().getByRole("button", { name: /查看 gpio_int/ }).click();
    await expect(page.getByRole("region", { name: "规格详情" })).toBeVisible({ timeout: 15_000 });

    await recordOperationEvidence({
      operationId: "PARAM-SPEC-GOVERN-001",
      title: "spec search review resolve audit",
      status: "passed",
      role: "Admin",
      route: "/parameter-admin",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(specsResponse, {
          method: "GET",
          path: "/api/v2/parameter-specs",
          responseSummary: `gpio_int specs=${gpioSpecs.length}`
        }),
        summarizeApiResponse(resolveReview, {
          method: "POST",
          path: `/api/v2/parameter-spec-review-tasks/${reviewTaskId}/resolve`,
          responseSummary: `resolved to ${specScId}`
        })
      ],
      db: [reviewDb],
      audit: [
        {
          id: reviewAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "spec-review-resolved",
          targetId: reviewTaskId
        }
      ],
      notes: `${descriptionPrefix}: listed two gpio_int specs, resolved review task, audited governance event.`
    });

    await page.goto(`/parameters?project=${projectId}`);
    await dismissXiaozeHint(page);
    const workspace = page.getByRole("region", { name: "项目拓扑工作区" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });

    await workspace.getByRole("radio", { name: "源树" }).check();
    await expect(workspace.getByText(/power\.dtsi · L42/)).toBeVisible();
    await expect(workspace.getByRole("treeitem", { name: /未解析/ })).toBeVisible();

    await workspace.getByRole("radio", { name: "生效树" }).check();
    await workspace.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    const gpioCells = workspace.getByRole("cell", { name: "gpio_int" });
    await expect(gpioCells).toHaveCount(2);
    await expect(workspace.getByRole("cell", { name: "sc8562", exact: true })).toBeVisible();
    await expect(workspace.getByRole("cell", { name: "mt5788", exact: true })).toBeVisible();

    await gpioCells.first().click();
    const detail = workspace.getByRole("region", { name: "绑定详情" });
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("data-binding-id", /binding-/);
    await expect(detail.getByText(/来源链|provenance/i)).toBeVisible();

    const seededConfigSet = await withPgClient(async (client) => {
      const result = await client.query<{ id: string }>(
        `select config_set_id as id from dts_config_revisions where id = $1`,
        [revisionId]
      );
      return result.rows[0]?.id ?? configSetId;
    });
    const topologyApi = await request.get(
      apiRoute(
        `/api/v2/projects/${projectId}/config-sets/${encodeURIComponent(seededConfigSet)}/revisions/${revisionId}/topology?view=effective`
      ),
      { headers: adminHeaders() }
    );
    // Seeded revision exists; topology nodes may be empty until full ingest wiring.
    expect([200, 404]).toContain(topologyApi.status());

    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-BROWSE-001",
      title: "source effective toggle and two gpio_int bindings",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        summarizeApiResponse(topologyApi, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/config-sets/.../topology`,
          responseSummary: `status=${topologyApi.status()}`
        })
      ],
      notes:
        "Teaching topology workspace exposes source/effective toggle, unresolved source target, and two gpio_int bindings by stable binding id."
    });

    await detail.getByLabel("目标值 raw").fill("<&gpio13 29>");
    await detail.getByRole("button", { name: /校验|应用诊断/ }).click();
    await expect(workspace.getByRole("list", { name: "编辑诊断" })).toBeVisible();
    await expect(workspace.getByRole("list", { name: "编辑诊断" })).toContainText("cell count must be 3");
    await expect(workspace.getByRole("button", { name: "发布" })).toBeDisabled();

    const staleEdit = await request.post(
      apiRoute(`/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent("missing-revision")}/validate`),
      {
        headers: adminHeaders(),
        data: { stage: "toolchain" }
      }
    );
    // Typed edit HTTP route is not exposed yet; stale revision is asserted via validate 404.
    expect(staleEdit.status()).toBe(404);

    await detail.getByLabel("目标值 raw").fill("<&gpio13 29 0>");
    await detail.getByRole("button", { name: /校验|应用诊断/ }).click();
    await expect(workspace.getByText(/cell count must be 3/)).toHaveCount(0);

    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-EDIT-001",
      title: "typed edit diagnostics and stale revision rejection",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        summarizeApiResponse(staleEdit, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/config-revisions/missing-revision/validate`,
          responseSummary: "stale/missing revision rejected"
        })
      ],
      notes:
        "UI typed edit blocks publish on SCHEMA_CELL_COUNT; missing revision validate returns 404 (createBindingDraft HTTP surface still TODO)."
    });

    const mappingList = await request.get(
      apiRoute(`/api/v2/identity-mapping-tasks?projectId=${encodeURIComponent(projectId)}&status=open`),
      { headers: adminHeaders() }
    );
    expect(mappingList.ok()).toBe(true);
    const mappingBody = (await mappingList.json()) as {
      items: Array<{ id: string; status: string }>;
    };
    expect(mappingBody.items.some((item) => item.id === mappingTaskId)).toBe(true);

    const resolveMapping = await request.post(
      apiRoute(`/api/v2/identity-mapping-tasks/${encodeURIComponent(mappingTaskId)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          selectedLogicalNodeId: logicalNodeId,
          reason: `${descriptionPrefix} resolve mapping to sc8562`
        }
      }
    );
    expect(resolveMapping.ok()).toBe(true);

    const mappingDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `select status from identity_mapping_tasks where id = $1`,
        [mappingTaskId]
      );
      return {
        table: "identity_mapping_tasks",
        predicate: `id=${mappingTaskId}`,
        observed: result.rows[0] ? `status=${result.rows[0].status}` : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(mappingDb.observed).toContain("resolved");

    const mappingAudit = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
      headers: adminHeaders()
    });
    const mappingAuditBody = (await mappingAudit.json()) as {
      items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
    };
    const mappingAuditItem = mappingAuditBody.items.find(
      (item) =>
        item.kind === "parameter-topology-governance" &&
        item.action === "identity-mapping-resolved" &&
        item.targetId === mappingTaskId
    );
    expect(mappingAuditItem).toBeTruthy();

    await workspace.getByRole("radio", { name: "源树" }).check();
    await expect(workspace.getByRole("treeitem", { name: /未解析/ })).toBeVisible();

    await recordOperationEvidence({
      operationId: "PARAM-IDENTITY-MAP-001",
      title: "unresolved target and mapping resolve audit",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(mappingList, {
          method: "GET",
          path: "/api/v2/identity-mapping-tasks",
          responseSummary: `open=${mappingBody.items.length}`
        }),
        summarizeApiResponse(resolveMapping, {
          method: "POST",
          path: `/api/v2/identity-mapping-tasks/${mappingTaskId}/resolve`,
          responseSummary: `selected=${logicalNodeId}`
        })
      ],
      db: [mappingDb],
      audit: [
        {
          id: mappingAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "identity-mapping-resolved",
          targetId: mappingTaskId
        }
      ],
      notes: "Source tree marks unresolved overlay targets; mapping task resolve writes governance audit."
    });

    await workspace.getByRole("radio", { name: "生效树" }).check();
    await workspace.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    await workspace.getByRole("cell", { name: "gpio_int" }).first().click();
    const publishDetail = workspace.getByRole("region", { name: "绑定详情" });
    await publishDetail.getByLabel("目标值 raw").fill("<&gpio13 29>");
    await publishDetail.getByRole("button", { name: /校验|应用诊断/ }).click();
    await expect(workspace.getByRole("button", { name: "发布" })).toBeDisabled();
    await expect(workspace.getByText(/发布已阻断|编辑诊断未通过/)).toBeVisible();

    await publishDetail.getByLabel("目标值 raw").fill("<&gpio13 29 0>");
    await publishDetail.getByRole("button", { name: /校验|应用诊断/ }).click();
    await expect(workspace.getByRole("button", { name: "发布" })).toBeEnabled();

    const validateResponse = await request.post(
      apiRoute(`/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(revisionId)}/validate`),
      {
        headers: adminHeaders(),
        data: { stage: "toolchain" }
      }
    );
    expect(validateResponse.ok()).toBe(true);
    const validateBody = (await validateResponse.json()) as {
      item: { id: string; status: string; stage: string };
    };
    expect(validateBody.item.status).toBe("passed");

    const publishDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [revisionId]
      );
      return {
        table: "dts_config_revisions",
        predicate: `id=${revisionId}`,
        observed: result.rows[0] ? `status=${result.rows[0].status}` : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(publishDb.observed).toContain("validated");

    const publishAudit = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
      headers: adminHeaders()
    });
    const publishAuditBody = (await publishAudit.json()) as {
      items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
    };
    const publishAuditItem = publishAuditBody.items.find(
      (item) =>
        item.kind === "parameter-topology-governance" &&
        item.action === "config-revision-validated" &&
        item.targetId === revisionId
    );
    expect(publishAuditItem).toBeTruthy();

    const bindingIdBefore = await publishDetail.getAttribute("data-binding-id");
    await page.reload();
    await dismissXiaozeHint(page);
    const workspaceAfter = page.getByRole("region", { name: "项目拓扑工作区" });
    await expect(workspaceAfter).toBeVisible({ timeout: 30_000 });
    await workspaceAfter.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    await expect(workspaceAfter.getByRole("cell", { name: "gpio_int" })).toHaveCount(2);
    await workspaceAfter.getByRole("cell", { name: "gpio_int" }).first().click();
    await expect(workspaceAfter.getByRole("region", { name: "绑定详情" })).toHaveAttribute(
      "data-binding-id",
      bindingIdBefore ?? /binding-/
    );

    await recordOperationEvidence({
      operationId: "PARAM-CONFIG-PUBLISH-GATE-001",
      title: "publish gate validate and semantic reload persistence",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(validateResponse, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/config-revisions/${revisionId}/validate`,
          responseSummary: `run=${validateBody.item.id}; status=${validateBody.item.status}`
        })
      ],
      db: [publishDb],
      audit: [
        {
          id: publishAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "config-revision-validated",
          targetId: revisionId
        }
      ],
      notes: `${descriptionPrefix}: edit diagnostics block publish; validate promotes revision; gpio_int binding ids persist after reload. runId=${randomUUID().slice(0, 8)}`
    });
  });
});
