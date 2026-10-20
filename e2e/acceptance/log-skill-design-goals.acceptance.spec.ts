import "./helpers/loadAcceptanceEnvironment";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { openLogUploadDialog } from "./helpers/logAnalysis";
import { readSelectControlOptions, selectControlOption } from "./helpers/selectControl";
import type { AnalysisSkill } from "../../src/features/log-skills/types";

// Run in an isolated WISEEFF_RUNTIME_LANE with seeded admin auth,
// LOG_ANALYSIS_DETERMINISTIC=true and LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true.
// Automatic artifacts must never capture the one-time credential reveal.
test.use({ viewport: { width: 1440, height: 900 }, trace: "off", video: "off", screenshot: "off" });
test.setTimeout(170_000);

const sampleText = "INFO reg=0x20\n";
const signalName = "Thermal flag detected";
const decodedField = "thermal.reg.fields.THERMAL.value";

async function section(page: Page, name: string) {
  await page.getByRole("navigation", { name: "技能分区导航" }).getByRole("button", { name, exact: true }).click();
}

/** Only interpret the JSON command grammar actually offered by the Integration UI.
 * Reject any additional options/commands instead of attempting shell execution. */
function parseCopiedJsonCurl(curl: string) {
  const match = /^curl --fail-with-body '([^'\r\n]+)'\s+\\\n\s+-H "([^"\r\n]+)"\s+\\\n\s+-H '([^'\r\n]+)'\s+\\\n\s+--data '([^'\r\n]+)'$/.exec(curl.trim());
  if (!match) throw new Error("The copied JSON curl command no longer matches its supported grammar.");
  const [, endpoint, authorization, contentType, body] = match;
  if (authorization !== "Authorization: Bearer <集成凭据>" || contentType !== "Content-Type: application/json") {
    throw new Error("Unexpected headers in the copied JSON curl command.");
  }
  return { endpoint, authorization, contentType, body };
}

type Delivery = { body: Buffer; signature: string; timestamp: string };

async function webhookReceiver() {
  const received: Delivery[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ body: Buffer.concat(chunks), signature: request.headers["x-wiseeff-signature"]?.toString() ?? "",
        timestamp: request.headers["x-wiseeff-timestamp"]?.toString() ?? "" });
      response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { received, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/result`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

// Receiver algorithm from the integration guide: authenticate the original bytes
// and timestamp together, with a five-minute replay window and constant-time compare.
function validSignature(delivery: Delivery, secret: string) {
  if (!/^\d+$/.test(delivery.timestamp) || !/^sha256=[a-f0-9]{64}$/.test(delivery.signature)
    || Math.abs(Date.now() / 1000 - Number(delivery.timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${delivery.timestamp}.`).update(delivery.body).digest();
  const actual = Buffer.from(delivery.signature.slice("sha256=".length), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

test("forms only: template to published extractor, register decoder and decoded-field signal", async ({ page }, testInfo) => {
  const headers = { ...smokeHeaders(), ...authHeadersForRole("admin") };
  await signInBrowserAsRole(page, "admin", "/log-admin?tab=skills");
  await prepareInteractionSurface(page);
  await page.getByTestId("log-domain-governance").getByRole("button", { name: "新建技能", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建技能", exact: true });
  await create.getByLabel("名称", { exact: true }).fill(`acceptance-design-forms-${randomUUID()}`);
  await create.getByRole("radio", { name: /通用文本日志/ }).check();
  await create.getByTestId("file-drop-zone-input").setInputFiles({
    name: "thermal.log", mimeType: "text/plain", buffer: Buffer.from(sampleText)
  });
  const creating = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/v1/log-skills");
  await create.getByRole("button", { name: "创建技能", exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const skill = (await created.json() as { item: AnalysisSkill }).item;
  await expect(page).toHaveURL(new RegExp(`/log-admin/skills/${skill.id}$`));
  await section(page, "样例与解析");
  await page.getByRole("tablist", { name: "解析配置", exact: true }).getByRole("tab", { name: "抽取规则", exact: true }).click();
  await page.getByRole("button", { name: /^选择样例第 1 行：INFO reg=0x20/ }).click();
  await page.getByRole("button", { name: "从此行创建抽取规则", exact: true }).click();
  const extractor = page.getByRole("dialog", { name: "从此行创建抽取规则", exact: true });
  await extractor.getByLabel("抽取器标识", { exact: true }).fill("thermal");
  await extractor.getByRole("button", { name: "片段 reg=0x20", exact: true }).click();
  await expect(extractor.getByLabel("片段 0x20 的字段名", { exact: true })).toHaveValue("reg");
  await extractor.getByRole("button", { name: "保存抽取规则", exact: true }).click();
  await expect(extractor).toBeHidden();
  await testInfo.attach("01-extractor-from-sample", { body: await page.screenshot(), contentType: "image/png" });

  await section(page, "解码");
  await page.getByRole("button", { name: "新增寄存器", exact: true }).click();
  await page.getByLabel("寄存器标识", { exact: true }).fill("STATUS");
  await page.getByRole("button", { name: "新增字段", exact: true }).click();
  await page.getByLabel("字段 1 位范围", { exact: true }).fill("5:5");
  await page.getByLabel("字段 1 名称", { exact: true }).fill("THERMAL");
  await selectControlOption(page.getByRole("combobox", { name: "thermal.reg 解码器", exact: true }), "register:STATUS");
  await expect(page.getByRole("group", { name: "寄存器位条 · 8 位，高位到低位", exact: true })).toContainText("THERMAL");
  await testInfo.attach("02-register-decoder-form", { body: await page.screenshot(), contentType: "image/png" });

  await section(page, "信号");
  await page.getByRole("button", { name: "添加信号规则", exact: true }).click();
  await selectControlOption(page.getByRole("combobox", { name: "规则 1 条件 1类型", exact: true }), "field");
  await selectControlOption(page.getByRole("combobox", { name: /^规则 1 条件 1抽取字段：/ }), decodedField);
  await page.getByLabel("规则 1 条件 1值", { exact: true }).fill("1");
  await page.getByLabel("规则 1名称", { exact: true }).fill(signalName);
  await expect(page.getByRole("region", { name: "规则 1", exact: true })).toContainText("命中 1 次");
  await testInfo.attach("03-decoded-signal-form", { body: await page.screenshot(), contentType: "image/png" });

  await page.getByRole("group", { name: "未发布更改", exact: true }).getByRole("button", { name: "发布", exact: true }).click();
  const publishing = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/v1/log-skills/${skill.id}/publish`);
  await page.getByRole("dialog", { name: "发布技能", exact: true }).getByRole("button", { name: "发布", exact: true }).click();
  expect((await publishing).ok()).toBe(true);
  await expect(page.getByRole("dialog", { name: "发布技能", exact: true })).toBeHidden();
  const readback = await page.request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
  expect(readback.ok()).toBe(true);
  const published = (await readback.json() as { item: AnalysisSkill }).item;
  expect(published.currentRevision.status).toBe("published");
  expect(published.draft).toBeNull();
  const spec = published.currentRevision.spec;
  expect(spec.parsing?.extractors).toHaveLength(1);
  expect(spec.parsing?.extractors[0]).toMatchObject({ id: "thermal", fields: { reg: { type: "hex", decode: { register: "STATUS" } } } });
  expect(Object.keys(spec.parsing!.extractors[0].fields)).toEqual(["reg"]);
  expect(spec.parsing?.registers).toEqual({ STATUS: { width: 8, fields: [{ bits: [5, 5], name: "THERMAL" }] } });
  expect(Object.keys(spec.parsing?.registerMaps ?? {})).toHaveLength(0);
  expect(Object.keys(spec.parsing?.frames ?? {})).toHaveLength(0);
  expect(spec.signalRules?.rules).toHaveLength(1);
  expect(spec.signalRules?.rules[0]).toMatchObject({ name: signalName,
    anyOf: [{ type: "field", field: decodedField, operator: "equals", value: 1 }] });

  await page.goto("/logs");
  const uploadDialog = await openLogUploadDialog(page);
  await expect.poll(async () => (await readSelectControlOptions(uploadDialog.locator("#upload-log-domain")))
    .some((option) => option.value === skill.id)).toBe(true);
  await selectControlOption(uploadDialog.locator("#upload-log-domain"), skill.id);
  await uploadDialog.getByTestId("file-drop-zone-input").setInputFiles({
    name: "thermal.log", mimeType: "text/plain", buffer: Buffer.from(sampleText)
  });
  const uploading = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/v1/log-files");
  await uploadDialog.getByRole("button", { name: "开始分析", exact: true }).click();
  const uploaded = await uploading;
  expect(uploaded.status()).toBe(201);
  const recordId = (await uploaded.json() as { log: { id: string } }).log.id;
  let analyzed: { status: string; skillRevision?: { id: string }; signalSummary?: { signals: unknown[] } } | undefined;
  await expect.poll(async () => {
    const result = await page.request.get(apiRoute(`/api/v1/logs/${recordId}`), { headers });
    expect(result.ok()).toBe(true);
    analyzed = (await result.json()).item;
    return analyzed?.status;
  }, { timeout: 75_000 }).toBe("complete");
  expect(analyzed?.skillRevision).toMatchObject({ id: published.currentRevision.id });
  expect(analyzed?.signalSummary?.signals).toEqual(expect.arrayContaining([expect.objectContaining({
    source: "skill", title: signalName, count: 1, anchors: [{ file: "thermal.log", line: 1, content: "INFO reg=0x20" }]
  })]));
  await page.getByRole("tab", { name: "信号", exact: true }).click();
  await expect(page.getByRole("region", { name: "日志信号", exact: true })).toContainText(signalName);
  await testInfo.attach("04-published-skill-analysis-signal", { body: await page.screenshot(), contentType: "image/png" });
});

test("integration only: copied UI curl and newly revealed credential reach a signed result webhook", async ({ page, context }, testInfo) => {
  // Fixture setup is outside the integrator walkthrough; template creation already publishes v1.
  const headers = { ...smokeHeaders(), ...authHeadersForRole("admin") };
  const setup = await page.request.post(apiRoute("/api/v1/log-skills"), { headers,
    data: { name: `acceptance-design-integration-${randomUUID()}`, startingPoint: { templateId: "generic-text" } } });
  expect(setup.status()).toBe(201);
  const skill = (await setup.json() as { item: AnalysisSkill }).item;
  const receiver = await webhookReceiver();
  const secret = randomUUID();
  try {
    await signInBrowserAsRole(page, "admin", `/log-admin/skills/${skill.id}?section=integration`);
    await prepareInteractionSurface(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await page.getByRole("button", { name: "复制技能标识", exact: true }).click();
    await expect(page.getByText("已复制技能标识", { exact: true })).toBeVisible();
    const skillKey = await page.evaluate(() => navigator.clipboard.readText());
    await expect(page.getByLabel("技能标识", { exact: true })).toHaveValue(skillKey);
    await page.getByRole("button", { name: "复制上传地址", exact: true }).click();
    await expect(page.getByText("已复制上传地址", { exact: true })).toBeVisible();
    const endpoint = await page.evaluate(() => navigator.clipboard.readText());
    await expect(page.getByLabel("上传地址", { exact: true })).toHaveValue(endpoint);
    const jsonExample = page.locator("details").filter({ has: page.locator("summary", { hasText: "单文件 JSON / Base64" }) });
    await jsonExample.locator("summary").click();
    const visibleCurl = await jsonExample.locator("code").innerText();
    await jsonExample.getByRole("button", { name: "复制单文件 JSON / Base64命令", exact: true }).click();
    await expect(page.getByText("已复制单文件 JSON / Base64", { exact: true })).toBeVisible();
    const copiedCurl = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedCurl).toBe(visibleCurl);
    const command = parseCopiedJsonCurl(copiedCurl);
    expect(() => parseCopiedJsonCurl(`${copiedCurl}\nother-command`)).toThrow();
    expect(command.endpoint).toBe(endpoint);
    expect(JSON.parse(command.body).skillKey).toBe(skillKey);
    await testInfo.attach("05-integration-copyable-command", { body: await page.screenshot(), contentType: "image/png" });

    const editor = page.getByTestId("domain-webhook-editor");
    await editor.getByLabel("回调地址", { exact: true }).fill(receiver.url);
    await editor.getByLabel(/签名密钥/).fill(secret);
    await editor.getByRole("checkbox", { name: "启用结果回调", exact: true }).check();
    await editor.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(editor.getByRole("status")).toHaveText("配置已保存");

    await page.getByRole("button", { name: "签发凭据", exact: true }).click();
    const issue = page.getByRole("dialog", { name: "签发集成凭据", exact: true });
    const credentialName = `design-goals-${randomUUID()}`;
    await issue.getByLabel("凭据名称", { exact: true }).fill(credentialName);
    await expect(issue.getByRole("checkbox", { name: "绑定到当前技能", exact: true })).toBeChecked();
    await issue.getByRole("button", { name: "签发", exact: true }).click();
    const reveal = page.getByRole("dialog", { name: "保存集成凭据", exact: true });
    const token = await reveal.getByLabel("集成凭据", { exact: true }).inputValue();
    expect(/^wie_\S+$/.test(token)).toBe(true);
    await reveal.getByRole("checkbox", { name: "我已安全保存密钥", exact: true }).check();
    await reveal.getByRole("button", { name: "完成", exact: true }).click();
    await expect(reveal).toBeHidden();

    // --data implies POST. Preserve the copied body byte-for-byte: this example
    // embeds its sample Base64, so only the displayed credential placeholder changes.
    const headers = Object.fromEntries([command.authorization.replace("<集成凭据>", token), command.contentType].map((header) => {
      const separator = header.indexOf(":");
      return [header.slice(0, separator), header.slice(separator + 1).trim()];
    }));
    const pushed = await fetch(command.endpoint, { method: "POST", headers, body: command.body, redirect: "error", signal: AbortSignal.timeout(20_000) });
    expect(pushed.status).toBe(201);
    const upload = await pushed.json() as { log: { id: string } };
    await expect.poll(() => receiver.received.length, { timeout: 75_000 }).toBeGreaterThan(0);
    const delivery = receiver.received[0];
    expect(validSignature(delivery, secret)).toBe(true);
    expect(validSignature({ ...delivery, body: Buffer.concat([delivery.body, Buffer.from(" ")]) }, secret)).toBe(false);
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const expiredSignature = `sha256=${createHmac("sha256", secret).update(`${expiredTimestamp}.`).update(delivery.body).digest("hex")}`;
    expect(validSignature({ ...delivery, timestamp: expiredTimestamp, signature: expiredSignature }, secret)).toBe(false);
    const payload = JSON.parse(delivery.body.toString("utf8"));
    expect(payload).toMatchObject({ event: "log-analysis.completed", status: "complete", recordId: upload.log.id,
      skill: { key: skillKey, revisionId: skill.currentRevision.id } });
    expect(payload).not.toHaveProperty("rawLines");
    expect(payload).not.toHaveProperty("evidence");

    const reportUrl = new URL(command.endpoint);
    reportUrl.pathname = `/api/v1/logs/${encodeURIComponent(payload.recordId)}`;
    const report = await fetch(reportUrl, { headers: { Authorization: headers.Authorization }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    expect(report.status).toBe(200);
    expect((await report.json() as { item: { id: string; status: string; conclusion: string } }).item).toMatchObject({
      id: upload.log.id, status: "complete", conclusion: expect.any(String)
    });
    await page.getByRole("button", { name: `凭据 ${credentialName}：更多`, exact: true }).click();
    await page.getByRole("menuitem", { name: "撤销", exact: true }).click();
    await page.getByRole("dialog", { name: "撤销集成凭据", exact: true }).getByRole("button", { name: "撤销凭据", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "撤销集成凭据", exact: true })).toBeHidden();
    // Reload to display the actual result delivery; neither attachment contains the token.
    await page.reload();
    await expect(page.getByTestId("domain-webhook-deliveries")).toContainText("已送达");
    await testInfo.attach("06-first-push-signed-result-delivered", { body: await page.screenshot(), contentType: "image/png" });
    await testInfo.attach("signed-webhook-and-credential-read", { body: JSON.stringify({
      event: payload.event, recordId: payload.recordId, signatureVerified: true, reportReadStatus: report.status
    }), contentType: "application/json" });
  } finally {
    await receiver.close();
  }
});
