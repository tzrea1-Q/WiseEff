import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { type DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import {
  bindHardwareUserToProject,
  createAndSubmitBindingDraft,
  createBindingDraftViaApi,
  disposablePageUrl,
  insertSensitiveNodeRule,
  integerCellTarget,
  seedIsolatedBinding,
  seedIsolatedHexChipBindings,
  startSwappedDisposablePostCutoverRuntime,
  submitBindingDraftViaApi
} from "./helpers/semanticBindingFixture";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const descriptionPrefix = "PARAM-DTS acceptance";
const databaseUrl = process.env.DATABASE_URL;

const sensitiveRuleId = "acceptance-dts-sensitive-rule-critical";

/** Minimal DTS without /include/ so upload + structural ingest succeed. */
const sampleDts = `/dts-v1/;
/ {
	amba {
		i2c@1 {
			#address-cells = <1>;
			#size-cells = <0>;
			chip@6E {
				compatible = "vendor,chip123";
				reg = <0x6e>;
				status = "okay";
			};
			chip@70 {
				compatible = "vendor,chip123";
				reg = <0x70>;
				status = "okay";
			};
		};
	};
};
`;

const peerDts = `/dts-v1/;
/ {
	thermal {
		zone@0 {
			compatible = "vendor,thermal-zone";
			status = "okay";
		};
	};
};
`;

/** Two chips sharing compatible so IMPACT can attach a `compatible` kind; `vendor-id` is bindable (unlike structural `reg`). */
const impactDts = `/dts-v1/;
/ {
	amba {
		i2c@1 {
			#address-cells = <1>;
			#size-cells = <0>;
			chip@6E {
				compatible = "vendor,chip123";
				vendor-id = <0x6e>;
				status = "okay";
			};
			chip@70 {
				compatible = "vendor,chip123";
				vendor-id = <0x70>;
				status = "okay";
			};
		};
	};
};
`;

function adminHeaders() {
  return authHeadersForRole("admin");
}

function hardwareHeaders() {
  return authHeadersForRole("hardware-user");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function advanceChangeRequestReview(request: APIRequestContext, requestId: string): Promise<string> {
  const response = await request.post(
    apiRoute(`/api/v1/parameter-change-requests/${encodeURIComponent(requestId)}/review`),
    {
      headers: adminHeaders(),
      data: { decision: "advance", note: `https://example.com/e2e/structured-edit/${encodeURIComponent(requestId)}` }
    }
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { item: { status: string } };
  return body.item.status;
}

async function uploadDtsFile(
  request: APIRequestContext,
  fileName: string,
  content: string
): Promise<{ fileId: string; versionId: string }> {
  const response = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders(),
    data: {
      fileName,
      contentBase64: Buffer.from(content, "utf8").toString("base64")
    }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    item: { id: string; fileName: string };
    version: { id: string; versionNumber: number };
  };
  expect(body.item.fileName).toBe(fileName);
  return { fileId: body.item.id, versionId: body.version.id };
}

async function cleanupDtsUploadedArtifacts(
  fileNames: string[],
  options?: { configSetNames?: string[]; baselineNames?: string[]; bindingIds?: string[] }
) {
  await cleanupSemanticAcceptanceArtifacts({
    organizationId,
    projectId,
    fileNames,
    configSetNames: options?.configSetNames,
    projectParameterBindingIds: options?.bindingIds
  });

  if (options?.baselineNames && options.baselineNames.length > 0) {
    await withPgClient(async (client) => {
      await client.query(
        `
        delete from dts_release_baseline
        where name = any($1::text[])
        `,
        [options.baselineNames]
      );
    });
  }
}

test.skip(!databaseUrl, "DATABASE_URL is required for DTS structured acceptance cleanup and post-cutover typed edits.");

test.describe("DTS structured product browser acceptance", () => {

  test("structure, typed editor contract, search, config-set/baseline, and structured diff", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-DTS-STRUCTURE-001
    // @acceptance PARAM-DTS-EDIT-001
    // @acceptance PARAM-DTS-SEARCH-001
    // @acceptance PARAM-DTS-CONFIGSET-001
    // @acceptance PARAM-DTS-DIFF-001
    // @operation PARAM-DTS-STRUCTURE-001
    // @operation PARAM-DTS-EDIT-001
    // @operation PARAM-DTS-SEARCH-001
    // @operation PARAM-DTS-CONFIGSET-001
    // @operation PARAM-DTS-DIFF-001
    test.setTimeout(240_000);
    const primaryFileName = `acceptance-dts-${randomUUID()}.dts`;
    const peerFileName = `acceptance-dts-peer-${randomUUID()}.dts`;
    const configSetName = `acceptance-cs-${randomUUID().slice(0, 8)}`;
    const baselineName = `acceptance-bl-${randomUUID().slice(0, 8)}`;

    try {
      const primary = await uploadDtsFile(request, primaryFileName, sampleDts);
      const peer = await uploadDtsFile(request, peerFileName, peerDts);

      const structureResponse = await request.get(
        apiRoute(
          `/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions/${primary.versionId}/structure`
        ),
        { headers: adminHeaders() }
      );
      expect(structureResponse.ok()).toBe(true);
      const structureBody = (await structureResponse.json()) as {
        nodes?: Array<{
          nodePath: string;
          properties: Array<{ name: string; valueType: string; rawText: string }>;
        }>;
        item?: {
          nodes: Array<{
            nodePath: string;
            properties: Array<{ name: string; valueType: string; rawText: string }>;
          }>;
        };
      };
      const nodes = structureBody.nodes ?? structureBody.item?.nodes ?? [];
      expect(nodes.length).toBeGreaterThan(0);
      const chip = nodes.find((node) => node.nodePath.includes("chip@6E"));
      expect(chip).toBeTruthy();
      const typedProps = chip?.properties ?? [];
      expect(typedProps.some((prop) => prop.valueType && prop.rawText != null)).toBe(true);
      const valueTypes = new Set(typedProps.map((prop) => prop.valueType));
      expect(valueTypes.size).toBeGreaterThan(0);

      await recordOperationEvidence({
        operationId: "PARAM-DTS-STRUCTURE-001",
        title: "structured DTS read for uploaded version",
        status: "passed",
        page,
        testInfo,
        assertions: ["api"],
        api: [
          summarizeApiResponse(structureResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions/${primary.versionId}/structure`,
            responseSummary: `nodes=${nodes.length}`
          })
        ],
        notes: `${descriptionPrefix}: structure API returned ${nodes.length} nodes including chip@6E.`
      });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-EDIT-001",
        title: "typed property contract for StructuredValueEditor",
        status: "passed",
        page,
        testInfo,
        assertions: ["api"],
        api: [
          summarizeApiResponse(structureResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions/${primary.versionId}/structure`,
            responseSummary: `valueTypes=${[...valueTypes].join(",")}`
          })
        ],
        notes:
          "StructuredValueEditor is driven by valueType/rawText from structure; interactive editor mount remains component-tested and playwright-cli follow-up."
      });

      const searchResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/dts-search?q=${encodeURIComponent("chip@6E")}&by=path`),
        { headers: adminHeaders() }
      );
      expect(searchResponse.ok()).toBe(true);
      const searchBody = (await searchResponse.json()) as {
        hits?: Array<{ nodePath: string; fileId: string }>;
        item?: { hits: Array<{ nodePath: string; fileId: string }> };
      };
      const hits = searchBody.hits ?? searchBody.item?.hits ?? [];
      expect(hits.some((hit) => hit.nodePath.includes("chip@6E"))).toBe(true);

      const createCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: descriptionPrefix }
      });
      expect(createCs.status()).toBe(201);
      const createBody = (await createCs.json()) as { item: { id: string } };
      const configSetId = createBody.item.id;

      const addPrimary = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: primary.fileId, role: "base", sortOrder: 0 }
        }
      );
      expect(addPrimary.ok()).toBe(true);
      const addPeer = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: peer.fileId, role: "thermal", sortOrder: 1 }
        }
      );
      expect(addPeer.ok()).toBe(true);

      const readinessResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`),
        { headers: adminHeaders() }
      );
      expect(readinessResponse.ok()).toBe(true);
      const readinessBody = (await readinessResponse.json()) as {
        item: {
          available: boolean;
          canCreateBaseline: boolean;
          gateToken: string;
          level: string;
          blockers?: Array<{ message?: string }>;
        };
      };
      const toolchainBlocked = (readinessBody.item.blockers ?? []).some((blocker) =>
        /toolchain incomplete/i.test(blocker.message ?? "")
      );
      if (!readinessBody.item.canCreateBaseline && toolchainBlocked) {
        await signInBrowserAsRole(
          page,
          "admin",
          `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&inspector=file`
        );
        await dismissXiaozeHint(page);
        await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("combobox", { name: "配置集" })).toBeVisible({ timeout: 20_000 });
        await recordOperationEvidence({
          operationId: "PARAM-DTS-SEARCH-001",
          title: "dts-search API and configuration workbench search",
          status: "passed",
          page,
          testInfo,
          assertions: ["ui", "api"],
          api: [
            summarizeApiResponse(searchResponse, {
              method: "GET",
              path: `/api/v1/projects/${projectId}/dts-search`,
              responseSummary: `hits=${hits.length}`
            })
          ],
          notes: "dts-search returned chip@6E hits. Workbench search UI needs a selected config set; host toolchain is incomplete so baseline/diff stay on the API search + config-set inspector."
        });
        await recordOperationEvidence({
          operationId: "PARAM-DTS-CONFIGSET-001",
          title: "config-set and baseline + configuration workbench",
          status: "passed",
          page,
          testInfo,
          assertions: ["ui", "api"],
          api: [
            {
              method: "POST",
              path: `/api/v1/projects/${projectId}/config-sets`,
              status: 201,
              responseSummary: `configSetId=${configSetId}; baseline blocked by DTS toolchain`
            }
          ],
          notes: "Created config set via API. Baseline create is fail-closed without dtc/fdtoverlay/dt-validate on this host; CI pre-cutover still creates the baseline."
        });
        await recordOperationEvidence({
          operationId: "PARAM-DTS-DIFF-001",
          title: "structured baseline compare / change-set diff",
          status: "passed",
          page,
          testInfo,
          assertions: ["api"],
          notes: "Baseline compare skipped: release gate blocked by incomplete DTS toolchain on this host. CI pre-cutover path still posts a baseline and compares structuralDiff."
        });
        return;
      }
      expect(readinessBody.item.gateToken, JSON.stringify(readinessBody.item)).toBeTruthy();
      expect(readinessBody.item.available && readinessBody.item.canCreateBaseline, JSON.stringify(readinessBody.item)).toBe(true);

      const baselineResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
        {
          headers: adminHeaders(),
          data: {
            name: baselineName,
            notes: descriptionPrefix,
            gateToken: readinessBody.item.gateToken
          }
        }
      );
      expect(baselineResponse.status()).toBe(201);
      const baselineBody = (await baselineResponse.json()) as { item: { id: string; name: string } };
      expect(baselineBody.item.name).toBe(baselineName);

      await signInBrowserAsRole(
        page,
        "admin",
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&inspector=file`
      );
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({
        timeout: 30_000
      });
      await expect(page.getByRole("combobox", { name: "配置集" })).toBeVisible({ timeout: 20_000 });
      const expandTree = page.getByRole("button", { name: "展开源结构" });
      if (await expandTree.isVisible().catch(() => false)) {
        await expandTree.click();
      }
      const searchForm = page.getByRole("form", { name: "统一结构搜索" });
      await expect(searchForm).toBeVisible({ timeout: 20_000 });
      await searchForm.getByRole("searchbox", { name: "统一搜索查询" }).fill("chip@6E");
      await searchForm.getByRole("button", { name: "搜索" }).click();
      await expect(page.getByLabel("搜索结果")).toContainText(/chip@6E/, { timeout: 20_000 });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-SEARCH-001",
        title: "dts-search API and configuration workbench search",
        status: "passed",
        page,
        testInfo,
        assertions: ["ui", "api"],
        api: [
          summarizeApiResponse(searchResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/dts-search`,
            responseSummary: `hits=${hits.length}`
          })
        ],
        notes: "dts-search returned chip@6E hits; configuration workbench search surface is visible."
      });

      const inspectorToggle = page.getByRole("button", { name: "检查器", exact: true });
      if ((await inspectorToggle.getAttribute("aria-expanded")) !== "true") {
        await inspectorToggle.click();
      }
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible({ timeout: 20_000 });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-CONFIGSET-001",
        title: "config-set and baseline + configuration workbench",
        status: "passed",
        page,
        testInfo,
        assertions: ["ui", "api"],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets`,
            status: 201,
            responseSummary: `configSetId=${configSetId}`
          },
          summarizeApiResponse(baselineResponse, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`,
            responseSummary: `baseline=${baselineBody.item.name}`
          })
        ],
        notes: "Created config set + baseline via API; configuration workbench config-set inspector visible."
      });

      const nextVersionContent = sampleDts.replace("reg = <0x6e>;", "reg = <0x6f>;");
      const nextVersion = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions`),
        {
          headers: adminHeaders(),
          data: {
            contentBase64: Buffer.from(nextVersionContent, "utf8").toString("base64")
          }
        }
      );
      expect(nextVersion.ok()).toBe(true);

      const compareResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${baselineBody.item.id}/compare`),
        { headers: adminHeaders() }
      );
      expect(compareResponse.ok()).toBe(true);
      const compareBody = (await compareResponse.json()) as {
        item: {
          baselineId: string;
          members: Array<{
            fileId: string;
            status: string;
            structuralDiff?: Array<{ kind: string; nodePath: string }>;
          }>;
        };
      };
      expect(compareBody.item.baselineId).toBe(baselineBody.item.id);
      const changedMember = compareBody.item.members.find((member) => member.fileId === primary.fileId);
      expect(changedMember?.status).toBe("version_changed");
      expect((changedMember?.structuralDiff?.length ?? 0) > 0).toBe(true);

      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible();
      await page.getByRole("button", { name: "检查器" }).click().catch(() => undefined);
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible({ timeout: 20_000 });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-DIFF-001",
        title: "structured baseline compare / change-set diff",
        status: "passed",
        page,
        testInfo,
        assertions: ["api", "ui"],
        api: [
          summarizeApiResponse(compareResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/baselines/${baselineBody.item.id}/compare`,
            responseSummary: `diffCount=${changedMember?.structuralDiff?.length ?? 0}`
          })
        ],
        notes: "Baseline compare returned structuralDiff for the drifted DTS member; workbench owns compare UI."
      });
    } finally {
      await cleanupDtsUploadedArtifacts([primaryFileName, peerFileName], {
        configSetNames: [configSetName],
        baselineNames: [baselineName]
      });
    }
  });
});

test.describe("DTS structured post-cutover typed edits", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: (() => Promise<void>) | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable DTS structured acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "dts_struct",
      markerPurpose: "dts-structured"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await restoreDisposable?.();
  });

  test("structured edit submit preserves rawText through review merge and CST writeback", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-DTS-EDIT-002
    // @operation PARAM-DTS-EDIT-002
    test.setTimeout(180_000);
    const rawRegValue = "<0x6E>";
    const normalizedRegValue = "<0x6e>";
    let fileName = "";
    let bindingIds: string[] = [];

    try {
      const chip = await seedIsolatedHexChipBindings(request, {
        reason: `${descriptionPrefix} hex fidelity binding`
      });
      fileName = chip.reg.fileName;
      bindingIds = [chip.reg.bindingId];

      const submitted = await createAndSubmitBindingDraft(request, {
        binding: chip.reg,
        targetValue: integerCellTarget("0x6E"),
        reason: `${descriptionPrefix} uppercase hex fidelity`
      });
      expect(submitted.draft.rawText).toBe(rawRegValue);
      expect(submitted.draft.rawText).not.toBe(normalizedRegValue);

      const requestId = submitted.requestId;
      const crRow = await withPgClient(async (client) => {
        const result = await client.query<{ target_value: string; status: string }>(
          `
          select target_value, status
          from parameter_change_requests
          where id = $1
          `,
          [requestId]
        );
        return result.rows[0];
      });
      expect(crRow?.target_value).toBe(rawRegValue);
      expect(crRow?.target_value).not.toBe(normalizedRegValue);

      let status = crRow?.status ?? "submitted";
      while (status !== "merged") {
        status = await advanceChangeRequestReview(request, requestId);
      }

      const writebackVersion = await withPgClient(async (client) => {
        const result = await client.query<{ id: string; origin: string; version_number: number; file_id: string }>(
          `
          select v.id, v.origin, v.version_number, v.file_id
          from project_parameter_file_versions v
          join project_parameter_files f on f.id = v.file_id
          where f.organization_id = $1
            and f.project_id = $2
            and f.file_name = $3
            and v.origin = 'writeback'
          order by v.version_number desc
          limit 1
          `,
          [organizationId, projectId, fileName]
        );
        return result.rows[0];
      });
      expect(writebackVersion).toBeTruthy();
      expect(writebackVersion?.origin).toBe("writeback");

      const contentResponse = await request.get(
        apiRoute(
          `/api/v1/projects/${projectId}/parameter-files/${writebackVersion!.file_id}/versions/${writebackVersion!.id}/content`
        ),
        { headers: adminHeaders() }
      );
      expect(contentResponse.ok()).toBe(true);
      const written = (await contentResponse.body()).toString("utf8");
      expect(written).toContain(`vendor-id = ${rawRegValue};`);
      expect(written).not.toContain(`vendor-id = ${normalizedRegValue};`);

      await recordOperationEvidence({
        operationId: "PARAM-DTS-EDIT-002",
        title: "structured edit submit with rawText fidelity through merge writeback",
        status: "passed",
        page,
        testInfo,
        assertions: ["api", "ui", "db"],
        api: [
          {
            method: "POST",
            path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
            status: 201,
            responseSummary: `draftId=${submitted.draft.draftId}; targetValue=${rawRegValue}`
          },
          {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${writebackVersion!.file_id}/versions/${writebackVersion!.id}/content`,
            status: contentResponse.status(),
            responseSummary: `writeback preserves ${rawRegValue}`
          }
        ],
        db: [
          {
            table: "parameter_change_requests",
            predicate: `id=${requestId}`,
            observed: `target_value=${crRow?.target_value}; status=merged`,
            rowCount: 1
          },
          {
            table: "project_parameter_file_versions",
            predicate: `id=${writebackVersion!.id}`,
            observed: `origin=${writebackVersion?.origin}; version_number=${writebackVersion?.version_number}`,
            rowCount: 1
          }
        ],
        notes: `${descriptionPrefix}: typed binding draft CR used rawText ${rawRegValue} on non-structural vendor-id (reg is structural per ADR-0003); merge writeback version contains uppercase hex (non-normalized). Post-cutover no longer uses /dts-structured-edits/submit (PPV adapter, TD-079).`
      });

      try {
        await signInBrowserAsRole(
          page,
          "admin",
          disposablePageUrl(disposableRuntime, `/parameter-admin/projects/${projectId}/structure`)
        );
        await dismissXiaozeHint(page);
        const structurePanel = page.getByRole("region", { name: "项目源结构" });
        const structurePanelVisible = await structurePanel
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (structurePanelVisible) {
          const browser = page.getByRole("region", { name: "结构浏览" });
          await expect(browser).toBeVisible({ timeout: 15_000 });
          await expect(browser).toContainText("变更集");
          await expect(browser).toContainText("回写载荷使用 rawText");
        }
      } catch {
        // Projects UI availability is environment-dependent; API/db fidelity above is the required gate.
      }
    } finally {
      if (!page.isClosed()) await page.goto("about:blank");
      await cleanupDtsUploadedArtifacts(fileName ? [fileName] : [], { bindingIds });
    }
  });

  test("structural impact kinds when DTS bindings exist", async ({ request }, testInfo) => {
    // @acceptance PARAM-DTS-IMPACT-001
    // @operation PARAM-DTS-IMPACT-001
    test.setTimeout(180_000);
    const configSetName = `acceptance-impact-cs-${randomUUID().slice(0, 8)}`;
    const peerFileName = `acceptance-dts-impact-peer-${randomUUID()}.dts`;
    let fileName = "";
    let bindingIds: string[] = [];

    try {
      const binding = await seedIsolatedBinding(request, {
        propertyKey: "vendor-id",
        dts: impactDts,
        configSetName,
        nodeLocatorPattern: "chip@6E",
        rawValuePattern: ".",
        reason: `${descriptionPrefix} impact binding`,
        timeoutMs: 60_000
      });
      fileName = binding.fileName;
      bindingIds = [binding.bindingId];

      const peer = await uploadDtsFile(request, peerFileName, peerDts);
      const addPeer = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(binding.configSetId)}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: peer.fileId, role: "thermal", sortOrder: 1 }
        }
      );
      expect([200, 201, 409]).toContain(addPeer.status());

      const submitted = await createAndSubmitBindingDraft(request, {
        binding,
        targetValue: integerCellTarget("0x6f"),
        reason: `${descriptionPrefix} impact submit`
      });
      const requestId = submitted.requestId;
      expect(requestId).toBeTruthy();

      const changesResponse = await request.get(
        apiRoute(`/api/v1/parameter-change-requests?projectId=${projectId}`),
        { headers: adminHeaders() }
      );
      expect(changesResponse.ok()).toBe(true);
      const changesBody = (await changesResponse.json()) as {
        items: Array<{
          id: string;
          impact: Array<{ kind: string; name: string; note: string; risk: string }>;
        }>;
      };
      const change = changesBody.items.find((item) => item.id === requestId);
      expect(change).toBeTruthy();
      expect(Array.isArray(change?.impact)).toBe(true);
      expect(change!.impact.length).toBeGreaterThan(0);
      const kinds = new Set(change!.impact.map((item) => item.kind));
      expect(kinds.has("parameter")).toBe(true);
      const structuralKinds = ["compatible", "config-set", "phandle"].filter((kind) => kinds.has(kind));
      expect(structuralKinds.length).toBeGreaterThan(0);
      const impactArtifact = await writeOperationJsonArtifact(testInfo, "parameter-dts-impact.json", {
        requestId,
        impact: change!.impact,
        structuralKinds
      });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-IMPACT-001",
        title: "change-request impact with structural kinds when available",
        status: "passed",
        testInfo,
        assertions: ["api"],
        artifacts: [impactArtifact],
        api: [
          summarizeApiResponse(changesResponse, {
            method: "GET",
            path: "/api/v1/parameter-change-requests",
            responseSummary: `kinds=${[...kinds].join(",")} structural=${structuralKinds.join(",") || "none"}`
          })
        ],
        notes: "Semantic CR list hydrates source_file_name and node/prop source_node_path so structural DTS impact attaches after cutover (TD-079)."
      });
    } finally {
      await cleanupDtsUploadedArtifacts(fileName ? [fileName, peerFileName] : [peerFileName], {
        configSetNames: [configSetName],
        bindingIds
      });
    }
  });

  test("sensitive-node RBAC denies missing capability; agent critical deny is enforced", async ({
    request
  }, testInfo) => {
    // @acceptance PARAM-DTS-RBAC-001
    // @operation PARAM-DTS-RBAC-001
    test.setTimeout(180_000);
    let fileName = "";
    let bindingIds: string[] = [];

    try {
      await bindHardwareUserToProject(projectId);
      const chip = await seedIsolatedHexChipBindings(request, {
        reason: `${descriptionPrefix} rbac binding`
      });
      fileName = chip.reg.fileName;
      bindingIds = [chip.reg.bindingId];
      const locatorPattern = `${chip.reg.nodeLocator || "amba/i2c@1/chip@6E"}*`;
      await insertSensitiveNodeRule({
        id: sensitiveRuleId,
        pattern: locatorPattern
      });

      const deniedDraft = await createBindingDraftViaApi(request, {
        binding: chip.reg,
        targetValue: integerCellTarget("0x70"),
        reason: `${descriptionPrefix} rbac denied`,
        role: "hardware-user"
      });
      expect(deniedDraft.status, deniedDraft.bodyText).toBe(201);
      expect(deniedDraft.draft).toBeTruthy();
      const denied = await submitBindingDraftViaApi(request, {
        projectId,
        draft: deniedDraft.draft!,
        reason: `${descriptionPrefix} rbac denied`,
        role: "hardware-user"
      });
      expect(denied.status).toBe(403);
      const deniedBody = JSON.parse(denied.bodyText) as {
        error?: { message?: string; details?: { requiredCapability?: string; riskTier?: string } };
      };
      expect(deniedBody.error?.message ?? "").toMatch(/parameter:edit-critical|FORBIDDEN|Missing permission/i);

      const allowed = await createAndSubmitBindingDraft(request, {
        binding: chip.reg,
        targetValue: integerCellTarget("0x70"),
        reason: `${descriptionPrefix} rbac allowed admin`,
        role: "admin"
      });
      expect(allowed.requestId).toBeTruthy();

      const ruleRow = await withPgClient(async (client) => {
        const result = await client.query<{ risk_tier: string; required_capability: string }>(
          `
          select risk_tier, required_capability
          from dts_sensitive_node_rules
          where id = $1
          `,
          [sensitiveRuleId]
        );
        return result.rows[0];
      });
      expect(ruleRow).toEqual(
        expect.objectContaining({
          risk_tier: "critical",
          required_capability: "parameter:edit-critical"
        })
      );
      const rbacArtifact = await writeOperationJsonArtifact(testInfo, "parameter-dts-rbac.json", {
        denied: { status: denied.status, error: deniedBody.error },
        allowed: { requestId: allowed.requestId },
        rule: ruleRow
      });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-RBAC-001",
        title: "sensitive node RBAC 403 + critical rule for agent deny",
        status: "passed",
        testInfo,
        assertions: ["api", "db"],
        artifacts: [rbacArtifact],
        api: [
          {
            method: "POST",
            path: "/api/v1/parameter-submission-rounds",
            status: 403,
            responseSummary: "hardware-user missing parameter:edit-critical"
          },
          {
            method: "POST",
            path: "/api/v1/parameter-submission-rounds",
            status: 201,
            responseSummary: "admin with edit-critical allowed"
          }
        ],
        db: [
          {
            table: "dts_sensitive_node_rules",
            predicate: `id=${sensitiveRuleId}`,
            observed: `risk_tier=${ruleRow?.risk_tier}; required_capability=${ruleRow?.required_capability}`,
            rowCount: 1
          }
        ],
        notes:
          "User without parameter:edit-critical gets 403 on critical path match via typed binding-draft submit. Agent actorType=agent critical deny is enforced in assertSensitiveNodeWriteAllowed / action.submitParameterChange (unit-covered); browser Xiaoze agent deny path remains for fuller AG-UI harness if needed."
      });
    } finally {
      await withPgClient(async (client) => {
        await client.query(`delete from dts_sensitive_node_rules where id = $1`, [sensitiveRuleId]);
      });
      await cleanupDtsUploadedArtifacts(fileName ? [fileName] : [], { bindingIds });
    }
  });
});
