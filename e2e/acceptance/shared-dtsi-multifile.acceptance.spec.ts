import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import JSZip from "jszip";
import { test } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, dismissXiaozeHint, signInCatalogActor } from "./helpers/catalogBrowser";

test("inspects a ZIP before saving and preserves edited source until replacement is confirmed",async({page,catalogAcceptanceRuntime})=>{
  void catalogAcceptanceRuntime;
  await page.setViewportSize({width:1440,height:900});
  await signInCatalogActor(page,"org-admin","/parameter-admin/sources");
  await dismissXiaozeHint(page);
  await page.getByRole("button",{name:"导入资源",exact:true}).click();
  await expect(page.getByRole("button",{name:"选择文件",exact:true})).toBeVisible();
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toHaveCount(0);
  await page.locator('input[type="file"]').first().setInputFiles({name:"old.dtsi",mimeType:"text/plain",buffer:Buffer.from('/ { old {}; };\n')});
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toContainText("old");
  const archive=new JSZip();archive.file("lib/new.dtsi",'/ { new {}; };\n');archive.file("README.md","notes");
  await page.locator('input[type="file"]').first().setInputFiles({name:"replacement.zip",mimeType:"application/zip",buffer:await archive.generateAsync({type:"nodebuffer"})});
  const confirmation=page.getByRole("dialog",{name:"替换全部源码？"});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button",{name:"替换源码",exact:true}).click();
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toContainText("new");
  await expect(page.getByText("已忽略 1 个非源码文件")).toBeVisible();
  const resourceName=`Import reopen ${Date.now()}`;
  await page.getByLabel("资源名称",{exact:true}).fill(resourceName);
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  const resourceId=new URL(page.url()).searchParams.get("resource")!;
  const draft=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}`);
  expect(draft.status).toBe(200);
  await page.getByRole("button",{name:"返回资源列表",exact:true}).click();
  await page.getByRole("button",{name:resourceName,exact:true}).click();
  await expect(page.getByLabel("文件路径",{exact:true})).toHaveValue("lib/new.dtsi");
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toContainText("new");
  expect((draft.body as {item:{members:unknown[]}}).item.members).toEqual([expect.objectContaining({sourceName:"lib/new.dtsi",content:'/ { new {}; };\n'})]);
});

test.use({catalogRuntimeScope:import.meta.url,catalogRuntimeDatabaseUrl:process.env.TEST_DATABASE_URL});

test("imports a relative ZIP library, repairs missing dependencies and publishes all original source members",async({page,catalogAcceptanceRuntime},testInfo)=>{
  void catalogAcceptanceRuntime;
  const pageErrors:string[]=[],serverErrors:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);});
  await page.setViewportSize({width:1440,height:900});
  await signInCatalogActor(page,"org-admin","/parameter-admin/sources");
  await dismissXiaozeHint(page);
  await page.getByRole("button",{name:"导入资源",exact:true}).click();
  const original='/ { battery: battery { compatible = "test,multifile-battery"; status = "disabled"; }; };\r\n';
  const zip=new JSZip();
  zip.file("library/main.dtsi",'/include/ "parts/missing.dtsi"\n&project_host { status = "okay"; };\n');
  zip.file("library/parts/battery.dtsi",original);
  zip.file("include/constants.h","\uFEFF#define VOLTAGE 42\r\n");
  await page.locator('input[type="file"]').first().setInputFiles({name:"battery-library.zip",mimeType:"application/zip",buffer:await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"})});
  await page.getByText("构建设置",{exact:true}).click();
  const importedFiles=page.getByRole("navigation",{name:"资源文件",exact:true});
  await expect(importedFiles.getByRole("button",{name:"library/main.dtsi",exact:true})).toBeInViewport({ratio:1});
  await expect(importedFiles.getByRole("button",{name:"library/parts/battery.dtsi",exact:true})).toBeInViewport({ratio:1});
  await expect(importedFiles.getByRole("button",{name:"include/constants.h",exact:true})).toBeInViewport({ratio:1});
  await expect(page.getByLabel("文件路径",{exact:true})).toHaveValue("library/main.dtsi");
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toContainText('/include/ "parts/missing.dtsi"');
  const archiveBox=await importedFiles.boundingBox(),settingsBox=await page.locator(".shared-dtsi-settings").boundingBox();
  expect(archiveBox).not.toBeNull();expect(settingsBox).not.toBeNull();
  expect(Math.abs(archiveBox!.y-settingsBox!.y)).toBeLessThan(24);
  expect(archiveBox!.x).toBeGreaterThanOrEqual(settingsBox!.x+settingsBox!.width);
  await page.getByText("构建设置",{exact:true}).click();
  await page.getByLabel("变更说明",{exact:true}).fill("保留完整源码与目录，供项目引用。");
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  const resourceId=new URL(page.url()).searchParams.get("resource")!;
  const files=page.getByRole("navigation",{name:"资源文件",exact:true});
  await files.getByRole("button",{name:"library/main.dtsi",exact:true}).click();
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("library/main.dtsi:1:1");
  await expect(page.getByRole("alert")).toContainText("missing.dtsi");
  await page.getByText("构建设置",{exact:true}).click();
  const errorEditorBox=await page.locator(".shared-dtsi-source").boundingBox(),errorSettingsBox=await page.locator(".shared-dtsi-settings").boundingBox();
  expect(errorEditorBox).not.toBeNull();expect(errorSettingsBox).not.toBeNull();
  expect(Math.abs(errorEditorBox!.y-errorSettingsBox!.y)).toBeLessThan(24);
  expect(errorEditorBox!.x).toBeGreaterThanOrEqual(errorSettingsBox!.x+errorSettingsBox!.width);
  await catalogScreenshot(page,testInfo,"shared-dtsi-multifile-missing-1440");
  await page.getByText("构建设置",{exact:true}).click();
  await files.getByRole("button",{name:"library/parts/battery.dtsi",exact:true}).click();
  await page.getByLabel("文件路径",{exact:true}).fill("library/parts/missing.dtsi");
  await files.getByRole("button",{name:"library/main.dtsi",exact:true}).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  await expect(page.getByRole("heading",{name:"发布 battery-library",exact:true})).toBeVisible();
  await expect(page.getByText("project_host",{exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"比较文件",exact:true}).click();await page.getByRole("option",{name:"新增 → include/constants.h",exact:true}).click();
  await expect(page.getByRole("region",{name:"共享原始源码修改片段",exact:true})).toContainText("#define VOLTAGE 42");
  await page.setViewportSize({width:1280,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await catalogScreenshot(page,testInfo,"shared-dtsi-multifile-preview-1280");
  await page.getByRole("button",{name:"发布版本",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("v1 · 已发布，只读",{exact:true})).toBeVisible();
  const detail=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}/detail`);
  const versionId=(detail.body as {item:{currentVersion:{id:string}}}).item.currentVersion.id;
  const version=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}/versions/${versionId}`);
  expect((version.body as {item:{members:unknown[]}}).item.members).toEqual(expect.arrayContaining([
    expect.objectContaining({sourceName:"library/parts/missing.dtsi",content:original}),
    expect.objectContaining({sourceName:"include/constants.h",content:"\uFEFF#define VOLTAGE 42\r\n"})
  ]));
  await page.getByRole("navigation",{name:"资源文件",exact:true}).getByRole("button",{name:"library/parts/missing.dtsi",exact:true}).click();
  await expect(page.getByLabel("已发布 DTSI 源码",{exact:true})).toHaveAttribute("aria-readonly","true");
  await page.setViewportSize({width:1440,height:900});
  await catalogScreenshot(page,testInfo,"shared-dtsi-multifile-published-1440");
  expect(pageErrors).toEqual([]);expect(serverErrors).toEqual([]);
});

test("selects a fixed cross-resource dependency in the full resource editor and publishes its exact closure",async({page,catalogAcceptanceRuntime},testInfo)=>{
  void catalogAcceptanceRuntime;
  const pageErrors:string[]=[],serverErrors:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);});
  await page.setViewportSize({width:1440,height:900});await signInCatalogActor(page,"org-admin","/parameter-admin/sources");await dismissXiaozeHint(page);
  const name=`Fixed clock source ${Date.now()}`;
  const created=await catalogJson(page.request,"POST","/api/v2/shared-dtsi",{data:{name,sourceName:"clocks.dtsi",content:'/ { fixed_clock: clocks { status = "okay"; }; };',changeDescription:"#1417 fixed dependency"}});
  expect(created.status).toBe(201);const leaf=(created.body as {item:{resourceId:string}}).item;
  const preview=await catalogJson(page.request,"POST",`/api/v2/shared-dtsi/${leaf.resourceId}/publication-preview`,{data:{expectedRevision:1}});
  expect(preview.status).toBe(201);
  const published=await catalogJson(page.request,"POST",`/api/v2/shared-dtsi/${leaf.resourceId}/publications`,{data:{previewId:(preview.body as {item:{id:string}}).item.id,idempotencyKey:`clock-${Date.now()}`}});
  expect(published.status).toBe(201);const publishedVersion=(published.body as {item:{id:string;digest:string;version:number}}).item,versionId=publishedVersion.id;
  expect(publishedVersion.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  await page.getByRole("button",{name:"导入资源",exact:true}).click();
  const source='/include/ "vendor/clocks.dtsi"\n&fixed_clock { frequency = <24000000>; };';
  await page.locator('input[type="file"]').first().setInputFiles({name:"platform.dtsi",mimeType:"text/plain",buffer:Buffer.from(source)});
  await page.getByLabel("资源名称",{exact:true}).fill(`Platform ${Date.now()}`);
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  await expect(page.getByLabel("变更说明",{exact:true})).toHaveAccessibleDescription("发布前请填写变更说明。");
  await expect(page.getByRole("button",{name:"预览发布",exact:true})).toBeDisabled();
  await page.getByText("引用其他共享资源",{exact:true}).click();
  await page.getByRole("button",{name:"选择共享资源",exact:true}).focus();await page.keyboard.press("Enter");
  await page.getByLabel("搜索共享资源",{exact:true}).focus();await page.keyboard.type(name);
  await page.getByRole("button",{name,exact:true}).focus();await page.keyboard.press("Enter");
  const versionPicker=page.getByRole("combobox",{name:"版本",exact:true});
  await expect(versionPicker).toBeEnabled();await versionPicker.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("option",{name:/^版本 1 ·/u})).toBeVisible();await page.keyboard.press("Enter");
  await page.getByText("引用目录（可选）",{exact:true}).click();
  for(const viewport of [{width:1440,height:900,lines:12},{width:1280,height:800,lines:8}]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const editor=page.locator(".shared-dtsi-source");
    const visible=await editor.evaluate(node=>{
      const box=node.getBoundingClientRect();let top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
      for(let parent=node.parentElement;parent;parent=parent.parentElement) {
        if(/^(auto|scroll|hidden|clip)$/u.test(getComputedStyle(parent).overflowY)) {
          const bounds=parent.getBoundingClientRect();top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);
        }
      }
      return Math.max(0,bottom-top);
    });
    const lineHeight=await editor.locator(".cm-line").first().evaluate(node=>parseFloat(getComputedStyle(node).lineHeight));
    expect(visible/lineHeight).toBeGreaterThanOrEqual(viewport.lines);
    await expect(page.getByLabel("引用目录",{exact:true})).toBeInViewport({ratio:1});
    await catalogScreenshot(page,testInfo,`shared-dependency-expanded-${viewport.width}`);
  }
  await page.getByLabel("引用目录",{exact:true}).focus();await page.keyboard.type("vendor");
  await page.getByRole("button",{name:"添加引用",exact:true}).focus();await page.keyboard.press("Enter");
  await expect(page.getByText(`${name} · 版本 1 · vendor`,{exact:true})).toBeVisible();
  await page.getByText("构建设置",{exact:true}).click();
  await page.getByLabel("头文件搜索目录",{exact:true}).fill("vendor");
  await page.getByLabel("预处理宏",{exact:true}).fill("ENABLED=1");
  await page.getByLabel("变更说明",{exact:true}).fill("#1417 reviewed fixed cross-resource closure");
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();const resourceId=new URL(page.url()).searchParams.get("resource")!;
  await page.reload();
  const dependencies=page.locator("details.shared-dtsi-dependencies");
  await expect(dependencies).not.toHaveAttribute("open","");
  await expect(dependencies.locator("summary")).toContainText(`${name} · 版本 1 · vendor`);
  await page.getByText("构建设置",{exact:true}).click();
  await expect(page.getByLabel("头文件搜索目录",{exact:true})).toHaveValue("vendor");
  await expect(page.getByLabel("预处理宏",{exact:true})).toHaveValue("ENABLED=1");
  await page.getByText("构建设置",{exact:true}).click();
  for(const viewport of [{width:1440,height:900},{width:1280,height:800}]) {
    await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByRole("button",{name:"预览发布",exact:true})).toBeInViewport({ratio:1});
    await catalogScreenshot(page,testInfo,`shared-dependency-editor-${viewport.width}`);
  }
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  await page.getByText("完整固定依赖（1）",{exact:true}).click();
  const closure=page.locator("details").filter({has:page.getByText("完整固定依赖（1）",{exact:true})});
  const pin=closure.getByRole("listitem").filter({hasText:name});
  await expect(pin).toHaveText(`${name} · 版本 1 · vendor 查看源码`);
  const sourceLink=new URL((await pin.getByRole("link",{name:"查看源码",exact:true}).getAttribute("href"))!,page.url());
  expect(sourceLink.searchParams.get("resource")).toBe(leaf.resourceId);expect(sourceLink.searchParams.get("version")).toBe(versionId);
  await page.getByRole("button",{name:"发布版本",exact:true}).focus();await page.keyboard.press("Enter");
  await expect(page.getByText("v1 · 已发布，只读",{exact:true})).toBeVisible();
  const detail=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}/detail`);
  const exact=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}/versions/${(detail.body as {item:{currentVersion:{id:string}}}).item.currentVersion.id}`);
  expect((exact.body as {item:{members:unknown[];manifest:{dependencyClosure:unknown[]}}}).item).toMatchObject({members:[expect.objectContaining({sourceName:"platform.dtsi",content:source})],manifest:{buildInputs:{includeSearchPaths:["vendor"],defines:{ENABLED:"1"}},dependencyClosure:[expect.objectContaining({resourceId:leaf.resourceId,versionId,mountPath:"vendor",name,version:publishedVersion.version,digest:publishedVersion.digest})]}});
  expect(pageErrors).toEqual([]);expect(serverErrors).toEqual([]);
});
