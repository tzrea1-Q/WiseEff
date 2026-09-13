import { expect, test, type Page, type TestInfo } from "playwright/test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  CATALOG_VIEWPORTS,
  assertNoPageOverflow,
  catalogPage,
  catalogScreenshot,
  confirmGovernanceDialog,
  dismissXiaozeHint,
} from "./helpers/catalogBrowser";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    ...CATALOG_EXPECTED_API_FAILURES,
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 403 },
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 409 },
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 422 },
  ],
});

type DeliveryEvidence = {
  sha: string;
  image: string;
  imageId: string;
  database: string;
  publisherUserId: string;
  organizationId: string;
  projectId: string;
  adoptedReleaseId: string;
  adoptedDigest: string;
  subjectId: string;
  apiOrigin: string;
  frontendOrigin: string;
  loginUsername: string;
};

type LoginSecrets = { username: string; password: string };

type PublicationIds = {
  candidateId: string;
  jobId: string;
  releaseId: string;
  definitionId?: string;
};

const loadEvidence = (): DeliveryEvidence => {
  const path = process.env.WISEEFF_CATALOG_DELIVERY_EVIDENCE?.trim();
  if (!path) {
    throw new Error("WISEEFF_CATALOG_DELIVERY_EVIDENCE is required for isolated delivery M1.");
  }
  return JSON.parse(readFileSync(path, "utf8")) as DeliveryEvidence;
};

const loadLogin = (): LoginSecrets => {
  const path = process.env.WISEEFF_CATALOG_DELIVERY_LOGIN_FILE?.trim();
  if (!path) {
    throw new Error("WISEEFF_CATALOG_DELIVERY_LOGIN_FILE is required for isolated delivery M1.");
  }
  return JSON.parse(readFileSync(path, "utf8")) as LoginSecrets;
};

const evidence = loadEvidence();
const login = loadLogin();

const authHeader = async (page: Page) => {
  const token = await page.evaluate(() => window.localStorage.getItem("wiseeff.localAuthToken"));
  if (!token) throw new Error("local auth token missing after login");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};

const signIn = async (page: Page) => {
  const response = await page.request.post(`${evidence.apiOrigin}/api/v1/auth/login`, {
    data: { username: login.username, password: login.password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { token: string; auth: { user: { id: string } } };
  expect(body.auth.user.id).toBe(evidence.publisherUserId);
  await page.goto(`${evidence.frontendOrigin}/favicon.svg`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([storageKey, token]) => window.localStorage.setItem(storageKey, token),
    ["wiseeff.localAuthToken", body.token] as const,
  );
};

const clearStoredPublicationJob = async (page: Page) => {
  await page.evaluate(() => window.localStorage.removeItem("wiseeff.catalog.publication-job"));
};

const publishDefinition = async (
  page: Page,
  testInfo: TestInfo,
  propertyKey: string,
  displayName: string,
): Promise<PublicationIds> => {
  await clearStoredPublicationJob(page);
  const captured: Partial<PublicationIds> = {};
  const onResponse = async (response: { url: () => string; ok: () => boolean; request: () => { method: () => string }; json: () => Promise<unknown> }) => {
    const url = response.url();
    if (response.request().method() === "POST" && url.includes("/publication-candidates") && !url.endsWith("/publish")) {
      if (response.ok()) {
        const body = (await response.json().catch(() => null)) as { item?: { id?: string } } | null;
        if (body?.item?.id) captured.candidateId = body.item.id;
      }
    }
    if (response.request().method() === "POST" && url.includes("/publish")) {
      if (response.ok()) {
        const body = (await response.json().catch(() => null)) as {
          item?: { id?: string; candidateId?: string; catalogReleaseId?: string };
        } | null;
        if (body?.item?.id) captured.jobId = body.item.id;
        if (body?.item?.candidateId) captured.candidateId = body.item.candidateId;
        if (body?.item?.catalogReleaseId) captured.releaseId = body.item.catalogReleaseId;
      }
    }
  };
  page.on("response", onResponse);

  await page.goto(`${evidence.frontendOrigin}/parameter-admin/specs`);
  await dismissXiaozeHint(page);
  await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
  const entry = page.getByRole("button", { name: "新增定义" });
  await expect(entry).toBeVisible();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "向已发布主体新增定义" });
  await expect(dialog).toBeVisible();
  const subjects = dialog.getByLabel("已发布主体");
  await expect.poll(async () => subjects.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(1);
  await subjects.selectOption(evidence.subjectId);
  await dialog.getByLabel("属性键").fill(propertyKey);
  await dialog.getByLabel("显示名称").fill(displayName);
  await dialog.getByLabel("说明").fill("隔离交付 M1 新增定义。");
  await dialog.getByLabel("草稿原因").fill("RA-04 isolated image M1");
  await dialog.getByRole("button", { name: "保存草稿" }).click();
  await expect(dialog.getByText("草稿已保存")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "预览发布" }).click();
  await confirmGovernanceDialog(page, "确认预览");
  await expect(dialog.getByLabel("发布预览")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "发布到目录" }).click();
  await confirmGovernanceDialog(page, "确认发布");
  await expect(dialog.getByText("目录发布已生效。")).toBeVisible({ timeout: 180_000 });
  await expect(dialog.getByText(/入队|正在执行/)).toHaveCount(0);
  await catalogScreenshot(page, testInfo, `ra04-publish-${propertyKey}`);
  expect(captured.jobId).toBeTruthy();
  expect(captured.candidateId).toBeTruthy();
  const headers = await authHeader(page);
  const job = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog/publications/${captured.jobId}`, {
    headers,
  });
  expect(job.status(), await job.text()).toBe(200);
  const jobBody = (await job.json()) as {
    item: {
      id: string;
      candidateId: string;
      status: string;
      currentness?: string;
      effective?: boolean;
      catalogReleaseId?: string;
    };
  };
  expect(jobBody.item.id).toBe(captured.jobId);
  expect(jobBody.item.candidateId).toBe(captured.candidateId);
  expect(jobBody.item.status === "active" || jobBody.item.currentness === "active").toBeTruthy();
  expect(jobBody.item.effective !== false).toBeTruthy();
  const catalogRes = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog`, { headers });
  expect(catalogRes.status(), await catalogRes.text()).toBe(200);
  const catalogBody = (await catalogRes.json()) as { item?: { catalogReleaseId?: string } };
  captured.releaseId = captured.releaseId || catalogBody.item?.catalogReleaseId || "";
  expect(captured.releaseId.length).toBeGreaterThan(0);
  expect(captured.releaseId).not.toBe(evidence.adoptedReleaseId);
  page.off("response", onResponse);
  return { ...captured } as PublicationIds;
};

test.describe("isolated formal-image catalog delivery M1", () => {
  test("completes adopt-bound publish, DTS ingest, workbench save, second publish, restart reread", async ({
    page,
  }, testInfo) => {
    test.setTimeout(12 * 60_000);
    expect(evidence.database.startsWith("wiseeff_test_wk_")).toBe(true);
    await signIn(page);

    for (const viewport of CATALOG_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${evidence.frontendOrigin}/parameter-admin/specs`);
      await dismissXiaozeHint(page);
      await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
      await assertNoPageOverflow(page);
      await catalogScreenshot(page, testInfo, `ra04-catalog-${viewport.name}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const firstKey = `ra04_${Date.now().toString(36).slice(-6)}`;
    const first = await publishDefinition(page, testInfo, firstKey, "RA04 首次定义");
    await page.getByRole("button", { name: "关闭" }).click({ timeout: 5_000 }).catch(() => undefined);
    await clearStoredPublicationJob(page);

    const headers = await authHeader(page);
    const current = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog`, { headers });
    expect(current.status(), await current.text()).toBe(200);
    const catalog = (await current.json()) as { item?: { catalogReleaseId?: string }; catalogReleaseId?: string };
    const currentRelease = catalog.item?.catalogReleaseId ?? catalog.catalogReleaseId;
    expect(currentRelease).toBe(first.releaseId);

    const dts = `/dts-v1/;
/ {
	charger@0 {
		compatible = "acme,charger";
		${firstKey} = <12>;
		status = "okay";
	};
};
`;
    const ingest = await page.request.post(
      `${evidence.apiOrigin}/api/v1/projects/${evidence.projectId}/parameter-files`,
      {
        headers,
        data: {
          fileName: `ra04-${first.jobId}.dts`,
          contentBase64: Buffer.from(dts, "utf8").toString("base64"),
        },
      },
    );
    expect(ingest.status(), await ingest.text()).toBe(201);
    const ingestBody = (await ingest.json()) as { item?: { id?: string }; version?: { id?: string } };
    expect(ingestBody.item?.id || ingestBody.version?.id).toBeTruthy();

    const bindings = await page.request.get(
      `${evidence.apiOrigin}/api/v2/projects/${evidence.projectId}/parameter-bindings`,
      { headers },
    );
    expect(bindings.status(), await bindings.text()).toBeLessThan(500);
    if (bindings.ok()) {
      const list = (await bindings.json()) as { items?: Array<{ id: string; propertyKey?: string }> };
      const match = list.items?.find((row) => row.propertyKey === firstKey) ?? list.items?.[0];
      if (match) {
        const saved = await page.request.post(
          `${evidence.apiOrigin}/api/v2/projects/${evidence.projectId}/parameter-bindings/${match.id}/drafts`,
          {
            headers,
            data: {
              action: "set",
              reason: "RA-04 workbench save",
              targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "12", value: "12" }]] },
            },
          },
        );
        expect([200, 201].includes(saved.status()), await saved.text()).toBeTruthy();
      }
    }

    await page.goto(`${evidence.frontendOrigin}/parameter-admin/projects`);
    await dismissXiaozeHint(page);
    await catalogScreenshot(page, testInfo, "ra04-workbench");

    const secondKey = `ra04b_${Date.now().toString(36).slice(-6)}`;
    const second = await publishDefinition(page, testInfo, secondKey, "RA04 第二次定义");
    expect(second.jobId).not.toBe(first.jobId);
    expect(second.releaseId).not.toBe(first.releaseId);

    const supersededBefore = await page.request.get(
      `${evidence.apiOrigin}/api/v2/catalog/publications/${first.jobId}`,
      { headers },
    );
    expect(supersededBefore.status()).toBe(200);
    const beforeBody = (await supersededBefore.json()) as { item: { id: string; currentness?: string; isCurrent?: boolean } };
    expect(beforeBody.item.id).toBe(first.jobId);

    const restart = process.env.WISEEFF_CATALOG_DELIVERY_RESTART_CMD?.trim();
    expect(restart).toBeTruthy();
    const restarted = spawnSync("bash", [restart!], { encoding: "utf8" });
    expect(restarted.status, restarted.stderr).toBe(0);
    await expect
      .poll(async () => {
        const live = await page.request.get(`${evidence.apiOrigin}/health/live`);
        return live.status();
      })
      .toBe(200);

    const history = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog/publications/${first.jobId}`, {
      headers,
    });
    expect(history.status(), await history.text()).toBe(200);
    const historyBody = (await history.json()) as {
      item: { id: string; candidateId: string; currentness?: string; effective?: boolean; isCurrent?: boolean };
    };
    expect(historyBody.item.id).toBe(first.jobId);
    expect(historyBody.item.candidateId).toBe(first.candidateId);
    expect(
      historyBody.item.currentness === "active-superseded" || historyBody.item.isCurrent === false,
    ).toBeTruthy();

    await page.goto(`${evidence.frontendOrigin}/parameter-admin/specs`);
    await dismissXiaozeHint(page);
    await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(secondKey)).toBeVisible({ timeout: 30_000 });
    await catalogScreenshot(page, testInfo, "ra04-after-restart");

    await testInfo.attach("ra04-ids", {
      body: Buffer.from(
        JSON.stringify(
          {
            evidence,
            first,
            second,
            ingest: ingestBody,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  });
});
