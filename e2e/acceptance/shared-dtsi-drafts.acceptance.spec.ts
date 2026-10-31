import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { test, catalogAppUrl } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, dismissXiaozeHint, signInCatalogActor } from "./helpers/catalogBrowser";

test.use({ catalogRuntimeScope: import.meta.url, catalogRuntimeDatabaseUrl: process.env.TEST_DATABASE_URL });

test("preserves multifile edits after a real revision conflict and rejects a reader's writes",async({page,catalogAcceptanceRuntime})=>{
  void catalogAcceptanceRuntime;
  await page.setViewportSize({width:1440,height:900});await signInCatalogActor(page,"org-admin","/parameter-admin/sources");await dismissXiaozeHint(page);
  const leaf=await catalogJson(page.request,"POST","/api/v2/shared-dtsi",{data:{name:"Conflict dependency",sourceName:"dep.dtsi",content:"/ { dep {}; };\n",changeDescription:"固定依赖"}});
  expect(leaf.status).toBe(201);const leafId=(leaf.body as {item:{resourceId:string}}).item.resourceId;
  const preview=await catalogJson(page.request,"POST",`/api/v2/shared-dtsi/${leafId}/publication-preview`,{data:{expectedRevision:1}});expect(preview.status).toBe(201);
  const publication=await catalogJson(page.request,"POST",`/api/v2/shared-dtsi/${leafId}/publications`,{data:{previewId:(preview.body as {item:{id:string}}).item.id,idempotencyKey:"conflict-fixed-dependency"}});expect(publication.status).toBe(201);
  const versionId=(publication.body as {item:{id:string}}).item.id,dependencies=[{resourceId:leafId,versionId,mountPath:"vendor"}];
  const original=[{sourceName:"main.dtsi",content:'/include/ "part.dtsi"\n/ { main {}; };\n'},{sourceName:"part.dtsi",content:"/ { part {}; };\n"}];
  const created=await catalogJson(page.request,"POST","/api/v2/shared-dtsi",{data:{name:"Conflict multifile",members:original,changeDescription:"原始说明",dependencies,buildInputs:{includeSearchPaths:["include"],defines:{ENABLED:"1"}}}});
  expect(created.status).toBe(201);
  const draft=(created.body as {item:{resourceId:string;revision:number;members:{id:string;sourceName:string;content:string}[]}}).item;
  await page.goto(catalogAppUrl(`/parameter-admin/sources?resource=${draft.resourceId}`));
  const editor=page.getByLabel("DTSI 源码",{exact:true}),files=page.getByRole("navigation",{name:"资源文件",exact:true});
  await expect(page.getByLabel("资源名称",{exact:true})).toHaveValue("Conflict multifile");
  await editor.click();await page.keyboard.press("ControlOrMeta+End");await page.keyboard.insertText("// local main\n");
  await files.getByRole("button",{name:"part.dtsi",exact:true}).click();await editor.click();await page.keyboard.press("ControlOrMeta+End");await page.keyboard.insertText("// local part\n");
  await page.getByLabel("变更说明",{exact:true}).fill("本地未保存说明");
  await page.getByText("构建设置",{exact:true}).click();await page.getByLabel("预处理宏",{exact:true}).fill("ENABLED=2");
  await page.getByLabel("头文件搜索目录",{exact:true}).fill("local/include");
  await expect(page.locator(".shared-dtsi-dependencies > summary").getByText("Conflict dependency · 版本 1 · vendor",{exact:true})).toBeVisible();
  const concurrent=await catalogJson(page.request,"PUT",`/api/v2/shared-dtsi/${draft.resourceId}/draft`,{data:{name:"Concurrent change",members:draft.members,changeDescription:"服务器版本",dependencies,buildInputs:{includeSearchPaths:["include"],defines:{ENABLED:"1"}},expectedRevision:draft.revision}});
  expect(concurrent.status).toBe(200);
  const save=page.waitForResponse(response=>response.request().method()==="PUT"&&new URL(response.url()).pathname===`/api/v2/shared-dtsi/${draft.resourceId}/draft`);
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();expect((await save).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("草稿已被更新");
  await page.getByRole("button",{name:"重新载入",exact:true}).click();await page.getByRole("dialog",{name:"重新载入草稿？"}).getByRole("button",{name:"继续编辑",exact:true}).click();
  await expect(editor).toContainText("local part");await files.getByRole("button",{name:"main.dtsi",exact:true}).click();await expect(editor).toContainText("local main");
  await expect(page.getByLabel("变更说明",{exact:true})).toHaveValue("本地未保存说明");
  await expect(page.getByLabel("预处理宏",{exact:true})).toHaveValue("ENABLED=2");await expect(page.getByLabel("头文件搜索目录",{exact:true})).toHaveValue("local/include");
  await expect(page.locator(".shared-dtsi-dependencies > summary").getByText("Conflict dependency · 版本 1 · vendor",{exact:true})).toBeVisible();
  const reader=await page.context().newPage();
  try{
    await signInCatalogActor(reader,"guest",`/parameter-admin/sources?resource=${draft.resourceId}`);await dismissXiaozeHint(reader);
    await expect(reader.getByLabel("文件路径",{exact:true})).toHaveAttribute("readonly","");
    await expect(reader.getByLabel("DTSI 源码",{exact:true})).toHaveAttribute("aria-readonly","true");
    for(const name of ["添加文件","添加目录","替换源码","替换为目录","新建源码","移除当前文件","保存草稿","预览发布"])await expect(reader.getByRole("button",{name,exact:true})).toHaveCount(0);
    await expect(reader.locator('input[type="file"]')).toHaveCount(0);
    const rejected=await catalogJson(reader.request,"PUT",`/api/v2/shared-dtsi/${draft.resourceId}/draft`,{actor:"guest",data:{name:"Unauthorized",members:draft.members,changeDescription:"",expectedRevision:draft.revision+1}});
    expect(rejected.status).toBe(403);
    const after=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${draft.resourceId}`);
    expect(after.status).toBe(200);expect(after.body).toMatchObject({item:{name:"Concurrent change",revision:draft.revision+1,members:draft.members}});
  }finally{await reader.close();}
});

test("imports and edits a shared DTSI draft, keeps stale input, and discards with the keyboard", async ({ page, catalogAcceptanceRuntime }, testInfo) => {
  void catalogAcceptanceRuntime;
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInCatalogActor(page, "org-admin", "/parameter-admin/sources");
  await dismissXiaozeHint(page);
  await page.getByRole("button", { name: "导入资源" }).click();
  const source = '/ { battery: battery { compatible = "test,shared-battery"; status = "disabled"; }; };\n';
  await page.locator('input[type="file"]').first().setInputFiles({ name: "common-battery.dtsi", mimeType: "text/plain", buffer: Buffer.from(source) });
  await expect(page.getByLabel("资源名称")).toHaveValue("common-battery");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  const resourceId = new URL(page.url()).searchParams.get("resource")!;
  const reopened = await catalogJson(page.request, "GET", `/api/v2/shared-dtsi/${resourceId}`);
  expect(reopened.status).toBe(200);
  const draft = (reopened.body as { item: { revision: number; members: { content: string }[] } }).item;
  expect(draft.members[0]!.content).toBe(source);
  await catalogScreenshot(page, testInfo, "shared-dtsi-draft-1440");
  await page.getByLabel("资源名称").fill("My local draft");
  const updated = await catalogJson(page.request, "PUT", `/api/v2/shared-dtsi/${resourceId}/draft`, { data: {
    name: "Concurrent administrator draft", sourceName: "common-battery.dtsi", content: source, expectedRevision: draft.revision
  } });
  expect(updated.status).toBe(200);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("alert")).toContainText("草稿已被更新");
  await expect(page.getByLabel("资源名称")).toHaveValue("My local draft");
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await catalogScreenshot(page, testInfo, "shared-dtsi-draft-conflict-1280");
  await page.getByRole("button", { name: "重新载入" }).click();
  const leave = page.getByRole("dialog", { name: "重新载入草稿？" });
  await leave.getByRole("button", { name: "重新载入", exact: true }).click();
  await expect(page.getByLabel("资源名称")).toHaveValue("Concurrent administrator draft");
  await page.getByRole("button", { name: "丢弃草稿", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "丢弃共享 DTSI 草稿？" });
  await discard.getByRole("button", { name: "丢弃草稿", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "共享 DTSI", exact: true })).toBeVisible();
  expect((await catalogJson(page.request, "GET", `/api/v2/shared-dtsi/${resourceId}`)).status).toBe(404);
});
