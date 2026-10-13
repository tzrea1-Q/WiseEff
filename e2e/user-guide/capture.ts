import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page } from "playwright/test";
import { loadAcceptanceEnvironment } from "../acceptance/helpers/acceptanceEnvironment";
import { acceptanceCast } from "../acceptance/helpers/cast";
import { apiRoute } from "../acceptance/helpers/runtime";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { requireCaptureDatabase } from "../../scripts/run-user-guide-screenshots";
import {
  closeXiaozePopupIfOpen,
  dismissCopilotDevOverlays,
  dismissXiaozeToggleHintIfPresent,
  expectUsablePage,
  seedQualityRuntime,
  settleAppToasts,
  settleQualityRoute,
  settleXiaozePopupClosed,
  waitForFontsAndNextPaint
} from "../quality/helpers";

requireCaptureDatabase();
loadAcceptanceEnvironment();

const imageDirectory = path.resolve("docs/user-guide/images");
const sampleLogName = "user-guide-thermal-foldback.log";
const knowledgeSamples = [
  {
    title: "充电热保护：定位降流原因",
    tags: ["Aurora", "充电", "热保护"],
    contentMarkdown: "## 演示场景\n日志出现 E_THERMAL_FOLDBACK 时，先核对电池温度、温度阈值和请求电流。\n\n## 排查步骤\n1. 检查告警前后的原始日志行。\n2. 核对散热路径和阈值配置。\n3. 在真实样机上完成复测，再提出参数变更。\n\n这是用户指南示例，不代表已完成设备验证。"
  },
  {
    title: "参数变更：提交前检查清单",
    tags: ["Aurora", "参数", "审阅"],
    contentMarkdown: "## 提交前\n确认项目、参数绑定、当前值、目标值和变更原因。\n\n## 审阅时\n检查冻结的源码差异和验证结果；出现源码漂移时应重新准备草稿。\n\n用户指南示例：提交请求不会直接写入设备。"
  },
  {
    title: "设备调试：连接与恢复基线",
    tags: ["Bridge", "设备调试"],
    contentMarkdown: "## 连接检查\n先确认本地 Bridge 在线，再确认 HDC 或 ADB 目标设备已授权。\n\n## 恢复检查\n保留预写快照和重载基线；恢复后再次读取设备并核对证据。\n\n用户指南截图不连接真实设备，不能替代样机验证。"
  }
];
let adminToken: string;
let knowledgeEntryId: string;

async function responseJson<Body>(method: "GET" | "POST", response: APIResponse): Promise<Body> {
  if (!response.ok()) {
    const url = new URL(response.url());
    throw new Error(`Sample-data API ${method} ${url.pathname}${url.search} returned ${response.status()}:\n${await response.text()}`);
  }
  return response.json();
}

async function loginDemo(request: APIRequestContext, username: string, expectedUserId: string) {
  const session = await responseJson<{ token: string; auth: { user: { id: string } } }>("POST", await request.post(apiRoute("/api/v1/auth/login"), {
    data: { username, password: LOCAL_DEMO_SHARED_PASSWORD }
  }));
  expect(session.token).toBeTruthy();
  expect(session.auth.user.id).toBe(expectedUserId);
  return session.token;
}

async function prepareSampleData(request: APIRequestContext) {
  adminToken = await loginDemo(request, "xu.yun", acceptanceCast.xuYun.userId);
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  for (const sample of knowledgeSamples) {
    const entries = await responseJson<{ items: Array<{ id: string; title: string; status: string }> }>(
      "GET", await request.get(apiRoute(`/api/v1/knowledge/entries?q=${encodeURIComponent(sample.title)}&limit=200`), { headers: adminHeaders })
    );
    let entry = entries.items.find((item) => item.title === sample.title);
    if (!entry) {
      entry = (await responseJson<{ item: { id: string; title: string; status: string } }>(
        "POST", await request.post(apiRoute("/api/v1/knowledge/entries"), {
          headers: adminHeaders, data: { contentForm: "markdown", ...sample }
        })
      )).item;
    }
    if (entry.status !== "published") {
      const published = await responseJson<{ item: { status: string } }>(
        "POST", await request.post(apiRoute(`/api/v1/knowledge/entries/${entry.id}/${entry.status === "archived" ? "restore" : "publish"}`), { headers: adminHeaders, data: {} })
      );
      expect(published.item.status).toBe("published");
    }
    if (sample === knowledgeSamples[0]) knowledgeEntryId = entry.id;
  }

}

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  requireCaptureDatabase();
  seedQualityRuntime();
  await mkdir(imageDirectory, { recursive: true });
  await prepareSampleData(request);
});

test.afterAll(async () => {
  const images = (await readdir(imageDirectory)).filter((name) => name.endsWith(".png"));
  const sizes = await Promise.all(images.map(async (name) => (await stat(path.join(imageDirectory, name))).size));
  expect(sizes.reduce((total, size) => total + size, 0), "Shared User Guide PNGs must total less than 4 MB").toBeLessThan(4_000_000);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wiseeff.theme", "light"));
});

async function openWorkflow(page: Page, route: string, token = adminToken) {
  await page.addInitScript((authToken) => localStorage.setItem("wiseeff.localAuthToken", authToken), token);
  await page.goto(route);
  await expectUsablePage(page);
  if (route.split("?")[0] !== "/logs") {
    await settleQualityRoute(page, route.split("?")[0], { readOnly: true });
  }
  await closeXiaozePopupIfOpen(page);
  await settleXiaozePopupClosed(page);
  await dismissXiaozeToggleHintIfPresent(page);
  await expect(page.locator(".api-runtime-sync-banner")).toHaveCount(0);
  await expect(page.locator(".api-runtime-error-banner")).toHaveCount(0);
}

async function capture(page: Page, name: string, surface?: Locator) {
  await settleAppToasts(page);
  await dismissCopilotDevOverlays(page);
  await waitForFontsAndNextPaint(page);
  if (name.startsWith("xiaoze-")) {
    const scroll = page.getByTestId("copilot-popup").locator(".xiaoze-chat-scroll");
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
  }
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const options = {
    path: path.join(imageDirectory, `${name}.png`),
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "css" as const,
    maskColor: "#f5f7fc",
    mask: [page.locator(".local-device-bridge-panel__pairing-code code, .local-device-bridge-panel__pairing-code time")]
  };
  if (surface) {
    await expect(surface).toBeVisible();
    await surface.screenshot(options);
  } else {
    await page.screenshot({ ...options, fullPage: false });
  }
}

async function openLocalAuth(page: Page) {
  await page.addInitScript(() => localStorage.removeItem("wiseeff.localAuthToken"));
  await page.goto("/parameter-home");
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录雷泽", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "注册", exact: true })).toBeVisible();
}

test("account-and-access-sign-in", async ({ page }) => {
  await openLocalAuth(page);
  await expect(page.getByRole("heading", { name: "登录雷泽", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  await capture(page, "account-and-access-sign-in", page.locator(".auth-panel"));
});

test("account-and-access-register", async ({ page }) => {
  await openLocalAuth(page);
  await page.getByRole("tab", { name: "注册", exact: true }).click();
  await expect(page.getByRole("heading", { name: "注册雷泽", exact: true })).toBeVisible();
  await capture(page, "account-and-access-register", page.locator(".auth-panel"));
});

async function openParameters(page: Page) {
  await openWorkflow(page, "/parameters?project=aurora");
  await expect(page.getByRole("tree", { name: "业务模块树" }).getByRole("treeitem").first()).toBeVisible();
  await expect(page.locator('.dts-parameter-workbench-table__body [role="row"]').first()).toBeVisible();
  await expect(page.getByRole("region", { name: "DTS 参数工作台", exact: true })).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("正在加载项目 JSON 绑定…", { exact: true })).toHaveCount(0);
}

test("parameter-management-workbench", async ({ page }) => {
  await openParameters(page);
  await capture(page, "parameter-management-workbench");
});

test("parameter-management-edit", async ({ page }) => {
  await openParameters(page);
  await page.getByRole("button", { name: /^编辑 / }).first().click();
  const editor = page.getByRole("dialog", { name: "修改草稿", exact: true });
  await expect(editor.getByRole("button", { name: "校验并加入本轮", exact: true })).toBeVisible();
  await capture(page, "parameter-management-edit", editor);
});

test("parameter-management-review", async ({ page }) => {
  await openWorkflow(page, "/parameter-review?project=aurora");
  await expect(page.getByRole("table", { name: "审阅队列" })).toBeVisible();
  await expect(page.getByText("正在加载审核队列…", { exact: true })).toHaveCount(0);
  const handled = page.getByRole("tablist", { name: "审阅视角" }).getByRole("tab", { name: "已处理", exact: true });
  await handled.click();
  await expect(handled).toHaveAttribute("aria-selected", "true");
  const handledRow = page.getByRole("table", { name: "审阅队列" }).locator("[data-review-row-id]").first();
  await expect(handledRow).toBeVisible();
  await handledRow.getByRole("button", { name: /提交详情/ }).click();
  const detail = page.getByRole("complementary", { name: "审阅详情", exact: true });
  await expect(detail).toBeVisible();
  await capture(page, "parameter-management-review");
});

test("device-debugging-nodes", async ({ page }) => {
  await openWorkflow(page, "/node-debugging");
  await collapseBridgeGuide(page);
  await expect(page.locator(".local-device-bridge-panel__connected")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "节点调试参数", exact: true }).getByRole("table")).toBeVisible();
  await capture(page, "device-debugging-nodes");
});

test("device-debugging-dts-reload", async ({ page }) => {
  await openWorkflow(page, "/dts-reload");
  await collapseBridgeGuide(page);
  await expect(page.locator(".local-device-bridge-panel__connected")).toHaveCount(0);
  await expect(page.getByRole("table", { name: "可调试参数", exact: true })).toBeVisible();
  await capture(page, "device-debugging-dts-reload");
});

async function collapseBridgeGuide(page: Page) {
  const collapse = page.getByRole("button", { name: "收起安装指南", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await expect(page.locator(".local-device-bridge-panel__guide")).toHaveCount(0);
}

async function openCompletedReport(page: Page, request: APIRequestContext) {
  const logs = await responseJson<{ items: Array<{ id: string; fileName: string }> }>(
    "GET", await request.get(apiRoute("/api/v1/logs"), { headers: { Authorization: `Bearer ${adminToken}` } })
  );
  const existingLog = logs.items.find((item) => item.fileName === sampleLogName);
  await openWorkflow(page, existingLog ? `/logs?logId=${existingLog.id}` : "/logs");
  if (existingLog) {
    await expect(page.locator(".history-item.active")).toContainText(sampleLogName);
    const rerun = page.getByRole("button", { name: "重新分析", exact: true });
    await expect(rerun).toBeEnabled({ timeout: 90_000 });
    await rerun.click();
  } else {
    await page.getByRole("toolbar", { name: /日志(?:分析工作台|智能分析)页面操作/ }).getByRole("button", { name: "上传新日志" }).click();
    const upload = page.getByRole("dialog", { name: "上传日志", exact: true });
    await upload.getByLabel("选择日志文件").setInputFiles({
      name: sampleLogName,
      mimeType: "text/plain",
      buffer: await readFile(path.resolve("test-fixtures/logs/charging-foldback.log"))
    });
    await upload.locator("#upload-analysis-question").fill("为什么快速充电发生热保护降流？请引用原始日志证据。");
    await upload.getByRole("button", { name: "确认上传", exact: true }).click();
    await expect(upload).toBeHidden({ timeout: 90_000 });
  }
  await expect(page.locator(".history-item.active")).toContainText(sampleLogName, { timeout: 90_000 });
  await expect(page.getByTestId("analysis-provenance")).toContainText("Agent 分析", { timeout: 90_000 });
  await expect(page.locator(".evidence-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("region", { name: "分析结果", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "日志分析证据链", exact: true })).toBeVisible();
}

test("log-analysis-report", async ({ page, request }) => {
  await openCompletedReport(page, request);
  await capture(page, "log-analysis-report");
});

test("log-analysis-evidence", async ({ page, request }) => {
  await openCompletedReport(page, request);
  const evidence = page.getByRole("region", { name: "日志分析证据链", exact: true });
  const card = evidence.locator(".evidence-card").first();
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  const analysis = page.getByRole("region", { name: "分析结果", exact: true });
  await expect(analysis.locator(".rawlog-line--anchor-focus").first()).toBeVisible();
  await capture(page, "log-analysis-evidence", analysis);
});

async function openKnowledge(page: Page) {
  await openWorkflow(page, "/knowledge");
  await expect(page.getByRole("table", { name: "知识条目列表" })).toBeVisible();
  await expect(page.getByText("正在加载知识条目…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  for (const sample of knowledgeSamples) {
    await expect(page.getByRole("table", { name: "知识条目列表" })).toContainText(sample.title);
  }
}

test("knowledge-library", async ({ page }) => {
  await openKnowledge(page);
  await capture(page, "knowledge-library");
});

test("knowledge-entry-detail", async ({ page }) => {
  await openWorkflow(page, `/knowledge?entryId=${knowledgeEntryId}`);
  const detail = page.getByRole("dialog", { name: new RegExp(knowledgeSamples[0].title) });
  await expect(detail.getByRole("region", { name: "条目内容", exact: true })).toContainText("E_THERMAL_FOLDBACK");
  await expect(detail).toContainText("已发布");
  await capture(page, "knowledge-entry-detail", detail);
});

test("knowledge-new-entry", async ({ page }) => {
  await openKnowledge(page);
  await page.getByRole("button", { name: "新建条目", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建 Markdown 条目", exact: true });
  await expect(editor.getByRole("textbox", { name: "条目标题", exact: true })).toBeVisible();
  await capture(page, "knowledge-new-entry", editor);
});

async function openGuideXiaoze(page: Page) {
  await openParameters(page);
  await page.getByTestId("copilot-chat-toggle").click();
  const popup = page.getByTestId("copilot-popup");
  await expect(popup).toBeVisible();
  await expect(page.locator(".api-runtime-sync-banner")).toHaveCount(0);
  await waitForFontsAndNextPaint(page);
  const scroll = popup.locator(".xiaoze-chat-scroll");
  await scroll.evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(popup.getByRole("heading", { name: "有什么可以帮您的？", exact: true })).toBeInViewport();
  return popup;
}

test("xiaoze-panel", async ({ page }) => {
  const popup = await openGuideXiaoze(page);
  await capture(page, "xiaoze-panel", popup);
});

test("xiaoze-history", async ({ page }) => {
  const popup = await openGuideXiaoze(page);
  await popup.getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.getByTestId("xiaoze-thread-history-panel")).toBeVisible();
  await capture(page, "xiaoze-history", popup);
});

test("organization-and-governance-members", async ({ page }) => {
  await openWorkflow(page, "/organization/members");
  await expect(page.getByRole("table", { name: "平台用户" })).toBeVisible();
  await expect(page.getByRole("table", { name: "平台用户" }).locator("tbody tr").first()).toContainText("Chen Na");
  await capture(page, "organization-and-governance-members");
});

test("organization-and-governance-audit", async ({ page }) => {
  await openWorkflow(page, "/audit");
  await expect(page.getByRole("searchbox", { name: "搜索审计记录", exact: true })).toBeVisible();
  await expect(page.getByText("正在加载审计记录…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".param-admin-audit-status-error")).toHaveCount(0);
  await capture(page, "organization-and-governance-audit");
});
