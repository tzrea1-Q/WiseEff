import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { expect, test } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { persistGate0ExactValuesForRescan } from "../../scripts/gate0-artifact-sanitizer";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";

test.use({ viewport: { width: 1440, height: 900 } });

test("downloads a blocked report, corrects the original and downloads the created result", async ({ page }, testInfo) => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane.");
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !/Failed to load resource: (the server responded with a status of 401|net::ERR_ABORTED)/.test(message.text())) browserErrors.push(message.text()); });
  page.on("requestfailed", request => { if (request.failure()?.errorText !== "net::ERR_ABORTED") browserErrors.push(`request failed: ${new URL(request.url()).pathname}`); });
  page.on("response", response => { if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/api/") && !(response.status() === 401 && new URL(response.url()).pathname === "/api/v1/me")) browserErrors.push(`API ${response.status()}: ${new URL(response.url()).pathname}`); });
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), organization = `bulk-report-${suffix}`, username = `report.${suffix}`;
  const registerSecret = (secret: string) => {
    for (const root of [process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/acceptance", process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR ?? "playwright-report/acceptance"]) {
      mkdirSync(path.resolve(root), { recursive: true }); persistGate0ExactValuesForRescan(path.resolve(root), [secret]);
    }
  };
  registerSecret(LOCAL_DEMO_SHARED_PASSWORD);
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,'导入清单目标')", [organization]);
    await client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,'bulk.operator',$2)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`, [acceptanceCast.platformOperator.userId, await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD)]);
  });
  await page.goto(`/organization/members?organizationId=${organization}`);
  await page.getByLabel("用户名", { exact: true }).fill("bulk.operator");
  await page.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/login");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  registerSecret((await (await login).json() as { token: string }).token);
  await prepareInteractionSurface(page);
  await expect(page.getByText("暂无组织成员。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "批量导入成员" });
  const workbook = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([["姓名", "用户名", "初始密码", "职务", "组织角色"], ["有效成员", username, LOCAL_DEMO_SHARED_PASSWORD, "工程师", "访客"], ["待修正成员", "x", LOCAL_DEMO_SHARED_PASSWORD, "", "访客"]]);
  XLSX.utils.book_append_sheet(workbook, data, "用户数据");
  const upload = () => dialog.getByLabel("选择填写后的 XLSX 文件").setInputFiles({ name: "roster.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer });
  await expect(dialog.getByLabel("选择填写后的 XLSX 文件")).toBeEnabled();
  await upload();
  await expect(dialog.getByText(/发现 .* 处问题/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /确认创建/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("user-import-errors-1440.png"), animations: "disabled" });
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = () => { URL.createObjectURL = original; throw new Error("download temporarily unavailable"); };
  });
  await dialog.getByRole("button", { name: "下载错误清单" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  const errorDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载错误清单" }).click();
  const errorPath = await (await errorDownload).path();
  expect(errorPath).toBeTruthy();
  const errorBook = XLSX.read(readFileSync(errorPath!), { type: "buffer" });
  const errorValues = XLSX.utils.sheet_to_json<string[]>(errorBook.Sheets[errorBook.SheetNames[0]], { header: 1 });
  expect(errorValues).toContainEqual(["2", username, "有效成员", "工程师", "未创建：整批校验未通过", "", ""]);
  expect(errorValues.some(row => row[0] === "3" && row[4] === "未创建：需修正")).toBe(true);
  expect(JSON.stringify(errorBook)).not.toContain(LOCAL_DEMO_SHARED_PASSWORD);
  data.B3 = { t: "s", v: `fixed.${suffix}` };
  await upload();
  await expect(dialog.getByText("预检通过", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认创建 2 位成员" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: "创建完成" })).toBeVisible();
  const resultDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载结果清单" }).click();
  const resultPath = await (await resultDownload).path();
  expect(resultPath).toBeTruthy();
  const resultBook = XLSX.read(readFileSync(resultPath!), { type: "buffer" });
  const resultValues = XLSX.utils.sheet_to_json<string[]>(resultBook.Sheets[resultBook.SheetNames[0]], { header: 1 });
  expect(resultValues).toContainEqual(["2", username, "有效成员", "", "已创建", "", ""]);
  expect(resultValues).toContainEqual(["3", `fixed.${suffix}`, "待修正成员", "", "已创建", "", ""]);
  expect(JSON.stringify(resultBook)).not.toContain(LOCAL_DEMO_SHARED_PASSWORD);
  await page.screenshot({ path: testInfo.outputPath("user-import-report-result-1440.png"), animations: "disabled" });
  expect(browserErrors).toEqual([]);
});
