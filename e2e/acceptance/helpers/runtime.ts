import { createHmac } from "node:crypto";
import { expect, type Page } from "playwright/test";
import { ACCEPTANCE_ORGANIZATION } from "./cast";

export type AcceptanceRuntimeEnv = Record<string, string | undefined>;

export function createBearerTokenForUser(userId: string, email: string, name: string, scopedOrganizationId: string = ACCEPTANCE_ORGANIZATION.id, env: AcceptanceRuntimeEnv = process.env) {
  const issuer = env.AUTH_TOKEN_ISSUER?.trim();
  const secret = env.AUTH_TOKEN_HMAC_SECRET?.trim();
  if (!issuer || !secret) return null;
  const payload = Buffer.from(JSON.stringify({
    iss: issuer, sub: userId, org: scopedOrganizationId, name, email, title: "Acceptance User", orgName: "ChargeLab",
    roles: [], permissions: [], isActive: true, nbf: 0, iat: Math.floor(Date.now() / 1000), exp: 9_999_999_999
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

const defaultApiBaseUrl = "http://127.0.0.1:8787";

export function apiBaseUrl(env: AcceptanceRuntimeEnv = process.env) {
  return env.VITE_WISEEFF_API_BASE_URL?.trim() || env.WISEEFF_API_BASE_URL?.trim() || defaultApiBaseUrl;
}

export function apiRoute(route: string, env: AcceptanceRuntimeEnv = process.env) {
  const base = apiBaseUrl(env).replace(/\/+$/, "");
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;

  return `${base}${normalizedRoute}`;
}

export function smokeHeaders(env: AcceptanceRuntimeEnv = process.env) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const authorization = env.M5_SMOKE_AUTHORIZATION?.trim() || env.WISEEFF_SMOKE_AUTHORIZATION?.trim();

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}

export async function openWorkbenchPanel(page: Page, panel: "file" | "config-set" | "versions" | "release" | "candidates") {
  const configurationVersions = page.getByRole("dialog", { name: "配置版本", exact: true });
  const restoredPanel = new URL(page.url()).searchParams.get("inspector");
  if (restoredPanel === "config-set") await expect(page.getByRole("dialog", { name: "配置组成", exact: true })).toBeVisible();
  if (restoredPanel === "release") await expect(configurationVersions).toBeVisible();
  if (panel !== "release" && await configurationVersions.isVisible()) {
    await configurationVersions.getByRole("button", { name: "关闭配置版本", exact: true }).click();
  }
  if (panel === "file" || panel === "versions" || panel === "candidates") {
    const files = page.getByRole("dialog", { name: "配置组成", exact: true });
    if (await files.isVisible()) await files.getByRole("button", { name: "关闭配置组成", exact: true }).click();
    const source = page.getByRole("tab", { name: "源码", exact: true });
    if (await source.count() && await source.getAttribute("aria-selected") !== "true") await source.click();
  }
  if (panel === "release") {
    if (await configurationVersions.isVisible()) return configurationVersions;
    const files = page.getByRole("dialog", { name: "配置组成", exact: true });
    if (await files.isVisible()) await files.getByRole("button", { name: "关闭配置组成", exact: true }).click();
    await page.getByRole("button", { name: /^配置版本/ }).click();
    await expect(configurationVersions).toBeVisible();
    return configurationVersions;
  } else if (panel === "candidates") {
    const [fileName] = await page.locator('.configuration-workbench__member-row[aria-selected="true"] strong').allTextContents();
    const files = await openWorkbenchPanel(page, "config-set");
    const scope = fileName ? files.getByRole("row").filter({ has: page.getByRole("button", { name: fileName, exact: true }) }) : files;
    await scope.getByRole("button", { name: /^(更新文件|更新记录|上传来源文件)$/ }).click();
  } else if (panel === "config-set") {
    const files = page.getByRole("dialog", { name: "配置组成", exact: true });
    if (await files.isVisible()) return files;
    await page.getByRole("button", { name: "配置", exact: true }).click();
    await page.getByRole("menuitem", { name: /^(配置组成|查看文件)$/ }).click();
    await expect(files).toBeVisible();
    return files;
  } else {
    const fileName = await page.locator('.configuration-workbench__member-row[aria-selected="true"] strong').innerText();
    await openWorkbenchFileActions(page, fileName);
    await page.getByRole("menuitem", { name: "版本历史与下载", exact: true }).click();
  }
  const inspector = page.getByRole("complementary", { name: "配置检查器" });
  await expect(inspector).toBeVisible();
  return inspector;
}

export async function selectWorkbenchConfigSet(page: Page, configSetId: string) {
  const trigger = page.getByRole("button", { name: "配置", exact: true });
  await trigger.click();
  const options = page.getByRole("menuitemradio");
  for (const option of await options.all()) {
    if (await option.getAttribute("data-value") !== configSetId) continue;
    await option.click();
    await expect(trigger).toHaveAttribute("data-value", configSetId);
    return;
  }
  throw new Error(`Configuration scheme not found: ${configSetId}`);
}

export async function openWorkbenchFileActions(page: Page, fileName: string) {
  const files = await openWorkbenchPanel(page, "config-set");
  await files.getByRole("button", { name: `${fileName} 更多`, exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openWorkbenchCreateConfigSet(page: Page) {
  await page.getByRole("button", { name: "配置", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建配置…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建配置", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function createWorkbenchConfigSet(page: Page, name: string) {
  const dialog = await openWorkbenchCreateConfigSet(page);
  await dialog.getByLabel("配置名称", { exact: true }).fill(name);
  const creating = page.waitForResponse((response) => response.request().method() === "POST"
    && /\/api\/v1\/projects\/[^/]+\/config-sets$/.test(new URL(response.url()).pathname));
  await dialog.getByRole("button", { name: "创建配置", exact: true }).click();
  const response = await creating;
  expect(response.status(), await response.text()).toBe(201);
  const item = (await response.json()).item as { id: string; name: string };
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "配置", exact: true })).toHaveAttribute("data-value", item.id);
  const files = page.getByRole("dialog", { name: "配置组成", exact: true });
  await expect(files).toBeVisible();
  await files.getByRole("button", { name: "关闭配置组成", exact: true }).click();
  return { response, item };
}

export async function openWorkbenchVersionMenu(page: Page, versionNumber: number) {
  const group = page.getByRole("complementary", { name: "配置检查器" })
    .getByRole("group", { name: `版本 ${versionNumber} 操作`, exact: true });
  const more = group.getByRole("button", { name: `版本 ${versionNumber} 操作：更多`, exact: true });
  await more.click();
  await expect(page.getByRole("menu")).toBeVisible();
  return more;
}

export async function ensureWorkbenchInspectorOpen(page: Page) {
  const files = page.getByRole("dialog", { name: "配置组成", exact: true });
  if (await files.isVisible()) await files.getByRole("button", { name: "关闭配置组成", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "配置检查器" });
  if (!(await inspector.isVisible())) {
    const query = new URL(page.url()).searchParams;
    if (query.get("node") && query.get("property") && query.get("sourceMode") !== "candidate") {
      await page.getByRole("treeitem", { name: `属性 ${query.get("node")}/${query.get("property")}`, exact: true }).click();
    } else {
      if (query.has("baseline") && query.get("sourceMode") !== "candidate") {
        await openWorkbenchPanel(page, "release");
        return;
      }
      await openWorkbenchPanel(page, query.get("sourceMode") === "candidate" ? "candidates" : "file");
    }
  }
  await expect(inspector).toBeVisible();
}
