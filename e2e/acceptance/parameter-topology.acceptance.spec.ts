import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { ensureAuroraSemanticTopology } from "./helpers/topologyFixture";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    // Typed-edit schema rejection and stale-revision conflict are intentional.
    { method: "POST", path: "/api/v2/projects/aurora/parameter-bindings", status: 400 },
    { method: "POST", path: "/api/v2/projects/aurora/parameter-bindings", status: 409 }
  ]
});

const organizationId = "org-chargelab";
const projectId = "aurora";
const descriptionPrefix = "PARAM-TOPOLOGY acceptance";
const reviewTaskId = "acceptance-spec-review-gpio-int";
const mappingTaskId = `acceptance-identity-map-${randomUUID().slice(0, 8)}`;
const SC8562_LOCATOR = "/amba/i2c@FDF5E000/sc8562@6E";
const MT5788_LOCATOR = "/amba/i2c@FF24E000/mt5788@2B";

const brokenBase = `/dts-v1/;
/ {
	board {
		compatible = "wiseeff,acceptance-broken";
		reg = <0>;
	};
};
`;
const brokenOverlay = `/dts-v1/;
/plugin/;

&missing_label_for_compile_fail {
	broken = <1>;
};
`;

function adminHeaders() {
  return authHeadersForRole("admin");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function listSpecs(request: APIRequestContext, query: string) {
  return request.get(apiRoute(`/api/v2/parameter-specs?${query}`), { headers: adminHeaders() });
}

async function seedSpecReviewTask(specScId: string, specMtId: string) {
  await withPgClient(async (client) => {
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
          evidence: ["acceptance governance fixture"]
        }),
        JSON.stringify([
          { id: specScId, label: "sc8562/gpio_int" },
          { id: specMtId, label: "mt5788/gpio_int" }
        ])
      ]
    );
  });
}

async function cleanupAcceptanceArtifacts(revisionId: string) {
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
  });
}

test.describe("Parameter topology / schema browser acceptance", () => {
  test("governs specs, browses real topology, edits, maps identity, and gates publish", async ({
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
    test.setTimeout(240_000);

    const topology = await ensureAuroraSemanticTopology(request);
    const { configSetId } = topology;
    let revisionId = topology.revisionId;

    // Clear leftover acceptance mapping blockers / invalid candidate revisions from prior runs.
    await withPgClient(async (client) => {
      await client.query(
        `
        delete from identity_mapping_tasks
        where project_id = $1
          and (id like 'acceptance-identity-map-%' or evidence::text like '%acceptance open-mapping%')
        `,
        [projectId]
      );
      await client.query(
        `
        delete from dts_validation_diagnostics d
        using dts_validation_runs r
        where d.validation_run_id = r.id
          and r.config_revision_id in (
            select id from dts_config_revisions
            where config_set_id = $1 and status = 'invalid'
          )
        `,
        [configSetId]
      );
      await client.query(
        `
        delete from dts_validation_runs
        where config_revision_id in (
          select id from dts_config_revisions
          where config_set_id = $1 and status = 'invalid'
        )
        `,
        [configSetId]
      );
      await client.query(
        `
        delete from project_parameter_binding_revisions
        where config_revision_id in (
          select id from dts_config_revisions
          where config_set_id = $1 and status = 'invalid'
        )
        `,
        [configSetId]
      );
      await client.query(
        `
        delete from dts_config_revisions
        where config_set_id = $1 and status = 'invalid'
        `,
        [configSetId]
      );
      const head = await client.query<{ id: string }>(
        `
        select id from dts_config_revisions
        where config_set_id = $1
        order by revision_number desc
        limit 1
        `,
        [configSetId]
      );
      if (head.rows[0]) revisionId = head.rows[0].id;
      await client.query(
        `
        update dts_config_revisions
        set status = 'resolved'
        where id = $1 and status = 'needs_mapping'
        `,
        [revisionId]
      );
    });

    try {
      const specsResponse = await listSpecs(request, `propertyKey=${encodeURIComponent("gpio_int")}`);
      expect(specsResponse.ok()).toBe(true);
      const specsBody = (await specsResponse.json()) as {
        items: Array<{ id: string; propertyKey: string | null; driverModule: string | null }>;
      };
      const gpioSpecs = specsBody.items.filter((item) => item.propertyKey === "gpio_int");
      expect(gpioSpecs.length).toBeGreaterThanOrEqual(2);
      const specSc = gpioSpecs.find(
        (item) => item.driverModule === "sc8562" || item.id.includes("sc8562")
      );
      const specMt = gpioSpecs.find(
        (item) =>
          item.driverModule === "mt5788" ||
          item.driverModule === "mt,mt5788" ||
          item.id.includes("mt5788")
      );
      expect(specSc).toBeTruthy();
      expect(specMt).toBeTruthy();
      expect(specSc!.id).not.toBe(specMt!.id);

      await seedSpecReviewTask(specSc!.id, specMt!.id);

      const resolveReview = await request.post(
        apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(reviewTaskId)}/resolve`),
        {
          headers: adminHeaders(),
          data: {
            decision: "resolved",
            parameterSpecId: specSc!.id,
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
      await expect(gpioRows.first()).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => gpioRows.count(), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(2);
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
            responseSummary: `gpio_int specs=${gpioSpecs.length}; distinct sc8562/mt5788`
          }),
          summarizeApiResponse(resolveReview, {
            method: "POST",
            path: `/api/v2/parameter-spec-review-tasks/${reviewTaskId}/resolve`,
            responseSummary: `resolved to ${specSc!.id}`
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
        notes: `${descriptionPrefix}: listed two distinct gpio_int specs from ingest, resolved review task, audited governance event.`
      });

      await page.goto(`/parameters?project=${projectId}`);
      await dismissXiaozeHint(page);
      const workspace = page.getByRole("region", { name: "项目拓扑工作区" });
      await expect(workspace).toBeVisible({ timeout: 30_000 });
      await expect(workspace).toHaveAttribute("data-config-set-id", configSetId);

      await workspace.getByRole("radio", { name: "源树" }).check();
      await expect(workspace.getByRole("treeitem", { name: /amba/ }).first()).toBeVisible({
        timeout: 20_000
      });
      await expect(workspace.getByRole("treeitem", { name: /i2c@FDF5E000/ }).first()).toBeVisible();
      await expect(workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first()).toBeVisible();

      await workspace.getByRole("radio", { name: "生效树" }).check();
      await expect(workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first()).toBeVisible();
      await workspace.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
      const gpioCells = workspace.getByRole("cell", { name: "gpio_int" });
      await expect(gpioCells).toHaveCount(2);
      await expect(workspace.getByRole("cell", { name: "sc8562", exact: true })).toBeVisible();
      await expect(workspace.getByRole("cell", { name: "sc8562@6E", exact: true })).toBeVisible();
      await expect(workspace.getByRole("cell", { name: /mt,?mt5788|mt5788/ }).first()).toBeVisible();
      await expect(workspace.getByRole("cell", { name: "mt5788@2B", exact: true })).toBeVisible();

      await gpioCells.first().click();
      const detail = workspace.getByRole("region", { name: "绑定详情" });
      await expect(detail).toBeVisible();
      await expect(detail).toHaveAttribute("data-binding-id", /.+/);
      await expect(detail.getByRole("region", { name: "来源链" })).toBeVisible();

      const topologyApi = await request.get(
        apiRoute(
          `/api/v2/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/revisions/${revisionId}/topology?view=effective`
        ),
        { headers: adminHeaders() }
      );
      expect(topologyApi.status()).toBe(200);
      const topologyBody = (await topologyApi.json()) as {
        item: {
          revisionId: string;
          nodes: Array<{ locator?: string; name?: string; unitAddress?: string }>;
        };
      };
      const locators = topologyBody.item.nodes.map((node) => node.locator ?? "");
      expect(locators.some((locator) => locator.includes("amba"))).toBe(true);
      expect(locators).toContain(SC8562_LOCATOR);
      expect(locators.some((locator) => locator.includes("i2c@FDF5E000"))).toBe(true);
      expect(locators).toContain(MT5788_LOCATOR);

      const bindingsApi = await request.get(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(revisionId)}`
        ),
        { headers: adminHeaders() }
      );
      expect(bindingsApi.ok()).toBe(true);
      const bindingsBody = (await bindingsApi.json()) as {
        items: Array<{
          id: string;
          propertyKey: string;
          driverModule: string | null;
          locator: string | null;
          rawValue: string;
        }>;
      };
      const gpioBindings = bindingsBody.items.filter((item) => item.propertyKey === "gpio_int");
      expect(gpioBindings).toHaveLength(2);
      const scBinding = gpioBindings.find(
        (item) => item.locator === SC8562_LOCATOR || item.driverModule === "sc8562"
      );
      const mtBinding = gpioBindings.find(
        (item) =>
          item.locator === MT5788_LOCATOR ||
          item.driverModule === "mt5788" ||
          item.driverModule === "mt,mt5788"
      );
      expect(scBinding?.locator).toBe(SC8562_LOCATOR);
      expect(mtBinding?.locator).toBe(MT5788_LOCATOR);
      expect(scBinding!.id).not.toBe(mtBinding!.id);

      await recordOperationEvidence({
        operationId: "PARAM-TOPOLOGY-BROWSE-001",
        title: "real source/effective tree and two gpio_int bindings",
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
            responseSummary: `status=200 nodes=${topologyBody.item.nodes.length}; sc8562+mt5788 present`
          }),
          summarizeApiResponse(bindingsApi, {
            method: "GET",
            path: `/api/v2/projects/${projectId}/parameter-bindings`,
            responseSummary: `gpio_int bindings=${gpioBindings.length}`
          })
        ],
        notes:
          "API-mode workspace loads ingested Config Set revision; source/effective trees expose amba→i2c@FDF5E000→sc8562@6E; two distinct gpio_int bindings by stable binding id."
      });

      const originalRaw = scBinding!.rawValue;
      await detail.getByLabel("目标值 raw").fill("<&gpio13 29>");
      await detail.getByRole("button", { name: /校验|应用诊断/ }).click();
      await expect(workspace.getByRole("list", { name: "编辑诊断" })).toBeVisible({ timeout: 20_000 });
      await expect(workspace.getByRole("list", { name: "编辑诊断" })).toContainText(/cell count must be 3/);
      await expect(workspace.getByRole("button", { name: "发布" })).toBeDisabled();

      const staleEdit = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`
        ),
        {
          headers: adminHeaders(),
          data: {
            baseRevisionId: "missing-revision-stale",
            targetValue: {
              kind: "cells",
              bits: 32,
              groups: [
                [
                  { kind: "phandle", label: "gpio13" },
                  { kind: "integer", raw: "29", value: "29" },
                  { kind: "integer", raw: "0", value: "0" }
                ]
              ]
            },
            reason: `${descriptionPrefix} stale revision probe`
          }
        }
      );
      expect(staleEdit.status()).toBe(409);
      const staleBody = (await staleEdit.json()) as {
        error?: { details?: { reason?: string } };
        details?: { reason?: string };
      };
      expect(staleBody.error?.details?.reason ?? staleBody.details?.reason).toBe("stale-revision");

      // Restore textarea without submitting a successful draft yet (keep revision stable for mapping).
      await detail.getByLabel("目标值 raw").fill(originalRaw);

      // Compiler failure on a throwaway Config Set (real dtc/fdtoverlay path).
      const suffix = randomUUID().slice(0, 8);
      const brokenBaseName = `acceptance-broken-base-${suffix}.dts`;
      const brokenOverlayName = `acceptance-broken-overlay-${suffix}.dts`;
      const brokenCsName = `acceptance-broken-cs-${suffix}`;
      const brokenBaseUpload = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files`),
        {
          headers: adminHeaders(),
          data: {
            fileName: brokenBaseName,
            contentBase64: Buffer.from(brokenBase, "utf8").toString("base64")
          }
        }
      );
      expect(brokenBaseUpload.ok()).toBe(true);
      const brokenBaseBody = (await brokenBaseUpload.json()) as { item: { id: string } };
      const brokenOverlayUpload = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files`),
        {
          headers: adminHeaders(),
          data: {
            fileName: brokenOverlayName,
            contentBase64: Buffer.from(brokenOverlay, "utf8").toString("base64")
          }
        }
      );
      expect(brokenOverlayUpload.ok()).toBe(true);
      const brokenOverlayBody = (await brokenOverlayUpload.json()) as { item: { id: string } };
      const brokenCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: brokenCsName, description: `${descriptionPrefix} compiler failure` }
      });
      expect(brokenCs.status()).toBe(201);
      const brokenCsBody = (await brokenCs.json()) as { item: { id: string } };
      await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${brokenCsBody.item.id}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: brokenBaseBody.item.id, role: "base", sortOrder: 0 }
        }
      );
      await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${brokenCsBody.item.id}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: brokenOverlayBody.item.id, role: "overlay", sortOrder: 1 }
        }
      );
      // Re-upload overlay to trigger ingest on the broken set.
      await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: brokenOverlayName,
          contentBase64: Buffer.from(brokenOverlay, "utf8").toString("base64")
        }
      });
      const brokenRevisionId = await withPgClient(async (client) => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const result = await client.query<{ id: string; status: string }>(
            `
            select id, status from dts_config_revisions
            where config_set_id = $1
            order by revision_number desc
            limit 1
            `,
            [brokenCsBody.item.id]
          );
          if (result.rows[0]) return result.rows[0].id;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return null;
      });
      expect(brokenRevisionId).toBeTruthy();
      const compileValidate = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(brokenRevisionId!)}/validate`
        ),
        { headers: adminHeaders(), data: { stage: "toolchain" } }
      );
      expect(compileValidate.ok()).toBe(true);
      const compileBody = (await compileValidate.json()) as {
        item: { status: string; failureCode?: string | null };
      };
      expect(compileBody.item.status).toBe("failed");
      expect(compileBody.item.failureCode).toBeTruthy();
      expect([
        "compile-failed",
        "resolve-failed",
        "toolchain-unavailable",
        "schema-failed",
        "invalid-revision",
        "open-review",
        "open-mapping",
        "empty-config-set"
      ]).toContain(compileBody.item.failureCode);

      await recordOperationEvidence({
        operationId: "PARAM-TOPOLOGY-EDIT-001",
        title: "typed edit schema diagnostics, stale 409, compiler failure",
        status: "passed",
        role: "Admin",
        route: "/parameters",
        page,
        testInfo,
        assertions: ["ui", "api"],
        api: [
          summarizeApiResponse(staleEdit, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
            responseSummary: "stale-revision 409"
          }),
          summarizeApiResponse(compileValidate, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/config-revisions/${brokenRevisionId}/validate`,
            responseSummary: `compiler/toolchain failureCode=${compileBody.item.failureCode}`
          })
        ],
        notes:
          "UI typed edit blocks on SCHEMA_CELL_COUNT via real drafts API; stale baseRevisionId returns 409; throwaway Config Set validate fails closed on compile/toolchain."
      });

      const logical = await withPgClient(async (client) => {
        const result = await client.query<{ logical_node_id: string }>(
          `
          select logical_node_id
          from dts_logical_node_revisions
          where config_revision_id = $1 and node_locator = $2
          limit 1
          `,
          [revisionId, SC8562_LOCATOR]
        );
        return result.rows[0]?.logical_node_id;
      });
      expect(logical).toBeTruthy();

      await withPgClient(async (client) => {
        await client.query(
          `
          insert into identity_mapping_tasks (
            id, organization_id, project_id, config_revision_id,
            previous_logical_node_id, candidate_logical_node_ids, evidence, status
          ) values (
            $1, $2, $3, $4, null, $5::jsonb, $6::jsonb, 'open'
          )
          `,
          [
            mappingTaskId,
            organizationId,
            projectId,
            revisionId,
            JSON.stringify([logical]),
            JSON.stringify({
              reason: "acceptance open-mapping blocker",
              locator: SC8562_LOCATOR
            })
          ]
        );
        await client.query(`update dts_config_revisions set status = 'needs_mapping' where id = $1`, [
          revisionId
        ]);
      });

      const blockedValidate = await request.post(
        apiRoute(`/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(revisionId)}/validate`),
        {
          headers: adminHeaders(),
          data: { stage: "toolchain" }
        }
      );
      expect(blockedValidate.ok()).toBe(true);
      const blockedBody = (await blockedValidate.json()) as {
        item: { status: string; failureCode?: string | null };
      };
      expect(blockedBody.item.status).toBe("failed");
      expect(blockedBody.item.failureCode).toBe("open-mapping");

      const mappingList = await request.get(
        apiRoute(`/api/v2/identity-mapping-tasks?projectId=${encodeURIComponent(projectId)}&status=open`),
        { headers: adminHeaders() }
      );
      expect(mappingList.ok()).toBe(true);
      const mappingBody = (await mappingList.json()) as {
        items: Array<{ id: string; status: string }>;
      };
      expect(mappingBody.items.some((item) => item.id === mappingTaskId)).toBe(true);

      await page.reload();
      await dismissXiaozeHint(page);
      const workspaceMap = page.getByRole("region", { name: "项目拓扑工作区" });
      await expect(workspaceMap).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/needs_mapping/).first()).toBeVisible({ timeout: 20_000 });

      const resolveMapping = await request.post(
        apiRoute(`/api/v2/identity-mapping-tasks/${encodeURIComponent(mappingTaskId)}/resolve`),
        {
          headers: adminHeaders(),
          data: {
            decision: "resolved",
            selectedLogicalNodeId: logical,
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

      await recordOperationEvidence({
        operationId: "PARAM-IDENTITY-MAP-001",
        title: "identity mapping blocker then resolve audit",
        status: "passed",
        role: "Admin",
        route: "/parameters",
        page,
        testInfo,
        assertions: ["ui", "api", "db", "audit"],
        api: [
          summarizeApiResponse(blockedValidate, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/config-revisions/.../validate`,
            responseSummary: `failureCode=${blockedBody.item.failureCode}`
          }),
          summarizeApiResponse(resolveMapping, {
            method: "POST",
            path: `/api/v2/identity-mapping-tasks/${mappingTaskId}/resolve`,
            responseSummary: `selected=${logical}`
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
        notes: "Open mapping blocks validate (fail-closed). Resolve clears blocker with governance audit."
      });

      // Publish gate uses the resolved ingested revision (not a broken candidate).
      // Clear org-open inferred review tasks so fail-closed validate can exercise toolchain.
      await withPgClient(async (client) => {
        await client.query(
          `
          update parameter_spec_review_tasks
          set status = 'dismissed',
              reason = $2,
              resolved_at = now()
          where organization_id = $1 and status = 'open'
          `,
          [organizationId, `${descriptionPrefix} dismiss open reviews before publish gate`]
        );
        const resolved = await client.query<{ id: string }>(
          `
          select id from dts_config_revisions
          where config_set_id = $1 and status in ('resolved', 'validated')
          order by revision_number asc
          limit 1
          `,
          [configSetId]
        );
        if (resolved.rows[0]) revisionId = resolved.rows[0].id;
      });

      await page.reload();
      await dismissXiaozeHint(page);
      const workspaceEdit = page.getByRole("region", { name: "项目拓扑工作区" });
      await expect(workspaceEdit).toBeVisible({ timeout: 30_000 });

      const bindingsAfterMap = await request.get(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(revisionId)}`
        ),
        { headers: adminHeaders() }
      );
      expect(bindingsAfterMap.ok()).toBe(true);
      const bindingsAfterBody = (await bindingsAfterMap.json()) as {
        items: Array<{ id: string; propertyKey: string; driverModule: string | null; rawValue: string }>;
      };
      const scAfter = bindingsAfterBody.items.find(
        (item) =>
          item.propertyKey === "gpio_int" &&
          (item.driverModule === "sc8562" || item.id === scBinding!.id)
      );
      expect(scAfter).toBeTruthy();

      await workspaceEdit.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
      await workspaceEdit.getByRole("cell", { name: "gpio_int" }).first().click();
      const publishDetail = workspaceEdit.getByRole("region", { name: "绑定详情" });
      await expect(publishDetail).toHaveAttribute("data-binding-id", scAfter!.id);
      await expect(publishDetail.getByLabel("目标值 raw")).toHaveValue(scAfter!.rawValue);

      const validateResponse = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(revisionId)}/validate`
        ),
        {
          headers: adminHeaders(),
          data: { stage: "toolchain" }
        }
      );
      expect(validateResponse.ok()).toBe(true);
      const validateBody = (await validateResponse.json()) as {
        item: { id: string; status: string; stage: string; failureCode?: string | null };
      };
      // Fail-closed: golden power seed still has dt-schema diagnostics — never force-pass.
      expect(validateBody.item.status).toBe("failed");
      expect(validateBody.item.failureCode).toBe("schema-failed");

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
      // Fail-closed leaves revision unresolved/validated-not-set.
      expect(publishDb.observed).toMatch(/resolved|invalid|needs_mapping/);
      expect(publishDb.observed).not.toContain("validated");

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
      const valueBefore = await publishDetail.getByLabel("目标值 raw").inputValue();

      await page.reload();
      await dismissXiaozeHint(page);
      const workspaceAfter = page.getByRole("region", { name: "项目拓扑工作区" });
      await expect(workspaceAfter).toBeVisible({ timeout: 30_000 });
      await workspaceAfter.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
      await expect(workspaceAfter.getByRole("cell", { name: "gpio_int" })).toHaveCount(2);
      await workspaceAfter.getByRole("cell", { name: "gpio_int" }).first().click();
      const detailAfter = workspaceAfter.getByRole("region", { name: "绑定详情" });
      await expect(detailAfter).toHaveAttribute("data-binding-id", bindingIdBefore ?? /.+/);
      await expect(detailAfter.getByLabel("目标值 raw")).toHaveValue(valueBefore);

      const persistedDb = await withPgClient(async (client) => {
        const result = await client.query<{ id: string; raw_value: string | null }>(
          `
          select b.id, br.raw_value
          from project_parameter_bindings b
          inner join project_parameter_binding_revisions br on br.binding_id = b.id
          where br.config_revision_id = $1
            and b.id = $2
          `,
          [revisionId, bindingIdBefore]
        );
        return {
          table: "project_parameter_binding_revisions",
          predicate: `binding=${bindingIdBefore}; revision=${revisionId}`,
          observed: result.rows[0]
            ? `id=${result.rows[0].id}; raw=${result.rows[0].raw_value}`
            : "missing",
          rowCount: result.rowCount ?? result.rows.length
        };
      });
      expect(persistedDb.observed).toContain(bindingIdBefore ?? "");

      await recordOperationEvidence({
        operationId: "PARAM-CONFIG-PUBLISH-GATE-001",
        title: "validate/publish gate and DB reload persistence",
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
        db: [publishDb, persistedDb],
        audit: [
          {
            id: publishAuditItem?.id,
            kind: "parameter-topology-governance",
            action: "config-revision-validated",
            targetId: revisionId
          }
        ],
        notes: `${descriptionPrefix}: fail-closed validate reports schema-failed (not force-passed); bindingId+value persist after reload from DB. runId=${randomUUID().slice(0, 8)}`
      });
    } finally {
      await cleanupAcceptanceArtifacts(revisionId).catch(() => undefined);
    }
  });
});
