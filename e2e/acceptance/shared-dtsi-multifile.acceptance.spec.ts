import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import JSZip from "jszip";
import { test, catalogAppUrl } from "./helpers/catalogFixtureRuntime";
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

test("safely adds, renames and removes draft members while retaining editor context",async({page,catalogAcceptanceRuntime},testInfo)=>{
  void catalogAcceptanceRuntime;
  await page.setViewportSize({width:1440,height:900});await signInCatalogActor(page,"org-admin","/parameter-admin/sources");await dismissXiaozeHint(page);
  await page.getByRole("button",{name:"导入资源",exact:true}).click();
  await page.locator('input[type="file"]').first().setInputFiles({name:"main.dtsi",mimeType:"text/plain",buffer:Buffer.from("/ { main {}; };\n")});
  const editor=page.getByLabel("DTSI 源码",{exact:true});
  await editor.click();await page.keyboard.press("ControlOrMeta+End");await page.keyboard.insertText("// unsaved\n");
  await page.getByLabel("变更说明",{exact:true}).fill("整理共享源码文件。");
  const add=page.locator('input[aria-label="添加源码文件"]');
  const partSource=`/ {\n${Array.from({length:30},(_,index)=>`  line-${index};\n`).join("")}};\n`;
  await add.setInputFiles({name:"part.dtsi",mimeType:"text/plain",buffer:Buffer.from(partSource)});
  const files=page.getByRole("navigation",{name:"资源文件",exact:true});
  await expect(files.getByRole("button",{name:"part.dtsi",exact:true})).toBeVisible();
  await expect(editor).toContainText("unsaved");
  await add.setInputFiles({name:"main.dtsi",mimeType:"text/plain",buffer:Buffer.from("replacement")});
  let conflict=page.getByRole("dialog",{name:"替换重名文件？",exact:true});
  await expect(conflict).toContainText("main.dtsi");await conflict.getByRole("button",{name:"取消",exact:true}).click();
  await expect(editor).toContainText("unsaved");await expect(page.getByLabel("变更说明",{exact:true})).toHaveValue("整理共享源码文件。");
  const mainSource='/include/ "part.dtsi"\n/ { replaced {}; };\n';
  await add.setInputFiles({name:"main.dtsi",mimeType:"text/plain",buffer:Buffer.from(mainSource)});
  conflict=page.getByRole("dialog",{name:"替换重名文件？",exact:true});await conflict.getByRole("button",{name:"替换重名文件",exact:true}).click();
  await expect(editor).toContainText("replaced");
  await files.getByRole("button",{name:"part.dtsi",exact:true}).focus();await page.keyboard.press("Enter");
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  const resourceId=new URL(page.url()).searchParams.get("resource")!;
  const beforeRename=(await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}`)).body as {item:{members:{id:string;sourceName:string;content:string}[]}};
  const originalMemberId=beforeRename.item.members.find(member=>member.sourceName==="part.dtsi")!.id;
  await page.getByLabel("文件路径",{exact:true}).fill("parts/part.dtsi");
  for(const viewport of [{width:1440,height:900},{width:1280,height:800}]){
    await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    // The line budget is measured after scrolling the normal collapsed-settings workspace to the editor.
    await editor.scrollIntoViewIfNeeded();
    const previewAction=page.getByRole("button",{name:"预览发布",exact:true});
    await expect(previewAction).toBeInViewport({ratio:1});
    expect(await previewAction.evaluate(element=>{const rect=element.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return hit===element || element.contains(hit);})).toBe(true);
    const font=await page.locator(".cm-editor").evaluate(element=>({size:getComputedStyle(element).fontSize,token:getComputedStyle(element).getPropertyValue("--text-sm").trim()}));
    expect(font.size).toBe(font.token);expect(Number.parseFloat(font.size)).toBeGreaterThanOrEqual(12);
    const visibleLines=await page.locator(".cm-line").evaluateAll(lines=>lines.filter(line=>{
      const rect=line.getBoundingClientRect(),scroll=line.closest(".cm-scroller")!.getBoundingClientRect(),body=line.closest(".shared-dtsi-resource-body")!.getBoundingClientRect();
      return rect.top>=Math.max(0,scroll.top,body.top) && rect.bottom<=Math.min(innerHeight,scroll.bottom,body.bottom);
    }).length);
    expect(visibleLines).toBeGreaterThanOrEqual(viewport.width===1440?12:8);
    await catalogScreenshot(page,testInfo,`shared-file-management-${viewport.width}`);
  }
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  await expect(page.getByLabel("文件路径",{exact:true})).toHaveValue("parts/part.dtsi");
  const persisted=await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}`);
  expect((persisted.body as {item:{members:unknown[]}}).item.members).toEqual(expect.arrayContaining([
    expect.objectContaining({sourceName:"main.dtsi",content:mainSource}),expect.objectContaining({id:originalMemberId,sourceName:"parts/part.dtsi",content:partSource})]));
  await page.reload();await expect(files.getByRole("button",{name:"parts/part.dtsi",exact:true})).toBeVisible();
  await files.getByRole("button",{name:"parts/part.dtsi",exact:true}).click();await expect(editor).toContainText("line-0");
  await files.getByRole("button",{name:"main.dtsi",exact:true}).click();await expect(editor).toContainText('/include/ "part.dtsi"');
  const reopened=(await catalogJson(page.request,"GET",`/api/v2/shared-dtsi/${resourceId}`)).body as {item:{members:{id:string;sourceName:string;content:string}[]}};
  expect(reopened.item.members.find(member=>member.sourceName==="parts/part.dtsi")).toMatchObject({id:originalMemberId,content:partSource});
  expect(reopened.item.members.find(member=>member.sourceName==="main.dtsi")?.content).toBe(mainSource);
  await page.getByRole("button",{name:"移除当前文件",exact:true}).click();await page.getByRole("dialog",{name:"移除文件？"}).getByRole("button",{name:"移除文件",exact:true}).click();
  await page.getByRole("button",{name:"移除当前文件",exact:true}).click();await page.getByRole("dialog",{name:"移除文件？"}).getByRole("button",{name:"移除文件",exact:true}).click();
  await expect(page.getByText("暂无源码文件，请添加文件或新建源码。",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"保存草稿",exact:true})).toBeDisabled();await expect(page.getByRole("button",{name:"预览发布",exact:true})).toBeDisabled();
});
test("locates a long source path without losing edits in another member",async({page,catalogAcceptanceRuntime},testInfo)=>{
  void catalogAcceptanceRuntime;
  const pageErrors:string[]=[],serverErrors:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);});
  await page.setViewportSize({width:1440,height:900});
  await signInCatalogActor(page,"org-admin","/parameter-admin/sources");
  await dismissXiaozeHint(page);
  await page.getByRole("button",{name:"导入资源",exact:true}).click();
  const longPath=`library/${"a".repeat(160)}.dtsi`;
  const zip=new JSZip();
  zip.file(longPath,'/include/ "missing.dtsi"\n/ {};\n');
  zip.file("library/other.dtsi",'/ { original {}; };\n');
  await page.locator('input[type="file"]').first().setInputFiles({name:"long-path.zip",mimeType:"application/zip",buffer:await zip.generateAsync({type:"nodebuffer"})});
  await expect(page.locator(".shared-dtsi-title")).not.toHaveAttribute("tabindex","0");
  const longName="长".repeat(160);
  await page.getByLabel("资源名称",{exact:true}).fill(longName);
  await page.getByLabel("变更说明",{exact:true}).fill("检查长路径定位");
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  const alert=page.getByRole("alert");
  await expect(alert).toContainText("缺少依赖文件 missing.dtsi");
  const locate=alert.getByRole("button",{name:`定位源码：${longPath}:1:1`,exact:true});
  const files=page.getByRole("navigation",{name:"资源文件",exact:true});
  await files.getByRole("button",{name:"library/other.dtsi",exact:true}).click();
  const editor=page.getByLabel("DTSI 源码",{exact:true});
  await editor.click();await page.keyboard.press("ControlOrMeta+End");await page.keyboard.insertText("// unsaved local edit");
  await page.getByLabel("变更说明",{exact:true}).fill("未保存的说明");
  for(const viewport of [{width:1440,height:900},{width:1280,height:800}]){
    await page.setViewportSize(viewport);
    const title=page.locator(".shared-dtsi-heading h1"),titleText=title.locator(".shared-dtsi-title");
    await expect(title).toHaveAccessibleName(new RegExp(longName));await expect(titleText).toHaveAttribute("tabindex","0");
    const titleSize=await titleText.evaluate(element=>({height:element.getBoundingClientRect().height,font:parseFloat(getComputedStyle(element).fontSize),truncated:element.scrollWidth>element.clientWidth}));
    expect(titleSize.height).toBeLessThanOrEqual(titleSize.font*1.7);expect(titleSize.truncated).toBe(true);
    await expect(page.locator(".shared-dtsi-draft-label")).toBeVisible();
    await page.getByRole("button",{name:"返回资源列表",exact:true}).focus();await page.keyboard.press("Tab");
    await expect(titleText).toBeFocused();await expect(page.getByRole("tooltip")).toHaveText(longName);await page.keyboard.press("Tab");
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
    await locate.focus();
    await expect(locate).toBeInViewport({ratio:1});
    expect(await locate.evaluate(element=>{const rect=element.getBoundingClientRect();const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+2);return hit===element || element.contains(hit);})).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const editorContainer=page.locator(".shared-dtsi-source");
    const visibleEditor=()=>editorContainer.evaluate(node=>{
      const box=node.getBoundingClientRect();let top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
      for(let parent=node.parentElement;parent;parent=parent.parentElement)if(/^(auto|scroll|hidden|clip)$/u.test(getComputedStyle(parent).overflowY)) {
        const bounds=parent.getBoundingClientRect();top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);
      }
      return Math.max(0,bottom-top);
    });
    const lineHeight=await editorContainer.locator(".cm-line").first().evaluate(node=>parseFloat(getComputedStyle(node).lineHeight));
    console.log(`long diagnostic ${viewport.width}x${viewport.height}: ${Number(((await visibleEditor())/lineHeight).toFixed(1))} visible editor lines before locating`);
    await catalogScreenshot(page,testInfo,`shared-dtsi-long-diagnostic-${viewport.width}`);
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("文件路径",{exact:true})).toHaveValue(longPath);
    await expect(editor).toBeFocused();
    await expect(editor).toBeInViewport();
    const afterLocate=Number(((await visibleEditor())/lineHeight).toFixed(1));
    console.log(`long diagnostic ${viewport.width}x${viewport.height}: ${afterLocate} visible editor lines after locating`);
    expect(afterLocate).toBeGreaterThanOrEqual(viewport.width===1440?12:8);
    await expect(editor).toContainText("missing.dtsi");
    await page.keyboard.press("ControlOrMeta+End");await page.keyboard.insertText("// keyboard edit\n");
    await expect(editor).toContainText("keyboard edit");
    await files.getByRole("button",{name:"library/other.dtsi",exact:true}).click();
    await expect(editor).toContainText("original");
    await expect(editor).toContainText("unsaved local edit");
    await expect(page.getByLabel("变更说明",{exact:true})).toHaveValue("未保存的说明");
  }
  expect(pageErrors).toEqual([]);expect(serverErrors).toEqual([]);
});

test("shows a truncated published title to keyboard users without losing its full name",async({page,catalogAcceptanceRuntime})=>{
  void catalogAcceptanceRuntime;
  await signInCatalogActor(page,"org-admin","/parameter-admin/sources");await dismissXiaozeHint(page);
  const name="长".repeat(160),base="/api/v2/shared-dtsi";
  const created=await catalogJson(page.request,"POST",base,{data:{name,sourceName:"published.dtsi",content:"/ {};",changeDescription:"发布长名称。"}});
  expect(created.status).toBe(201);const resourceId=(created.body as {item:{resourceId:string}}).item.resourceId;
  const preview=await catalogJson(page.request,"POST",`${base}/${resourceId}/publication-preview`,{data:{expectedRevision:1}});expect(preview.status).toBe(201);
  const published=await catalogJson(page.request,"POST",`${base}/${resourceId}/publications`,{data:{previewId:(preview.body as {item:{id:string}}).item.id,idempotencyKey:"long-title-published"}});expect(published.status).toBe(201);
  const versionId=(published.body as {item:{id:string}}).item.id;
  await page.goto(catalogAppUrl(`/parameter-admin/sources?resource=${resourceId}&version=${versionId}&tab=source`));
  for(const viewport of [{width:1440,height:900},{width:1280,height:800}]) {
    await page.setViewportSize(viewport);
    const heading=page.locator(".shared-dtsi-heading h1"),title=heading.locator(".shared-dtsi-title");
    await expect(heading).toHaveAccessibleName(name);await expect(title).toHaveAttribute("tabindex","0");
    const dimensions=await title.evaluate(element=>({height:element.getBoundingClientRect().height,font:parseFloat(getComputedStyle(element).fontSize),truncated:element.scrollWidth>element.clientWidth}));
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.font*1.7);expect(dimensions.truncated).toBe(true);
    await page.getByRole("button",{name:"返回资源列表",exact:true}).focus();await page.keyboard.press("Tab");
    await expect(title).toBeFocused();await expect(page.getByRole("tooltip")).toHaveText(name);await page.keyboard.press("Tab");
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

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
  const archiveBox=await page.locator(".shared-dtsi-editor-column").boundingBox(),settingsBox=await page.locator(".shared-dtsi-settings").boundingBox();
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
  const errorEditorBox=await page.locator(".shared-dtsi-editor-column").boundingBox(),errorSettingsBox=await page.locator(".shared-dtsi-settings").boundingBox();
  expect(errorEditorBox).not.toBeNull();expect(errorSettingsBox).not.toBeNull();
  expect(Math.abs(errorEditorBox!.y-errorSettingsBox!.y)).toBeLessThan(24);
  expect(errorEditorBox!.x).toBeGreaterThanOrEqual(errorSettingsBox!.x+errorSettingsBox!.width);
  for(const viewport of [{width:1440,height:900,lines:12},{width:1280,height:800,lines:8}]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
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
    await expect(page.getByLabel("文件路径",{exact:true})).toBeInViewport({ratio:1});
    await expect(page.getByRole("button",{name:"移除当前文件",exact:true})).toBeInViewport({ratio:1});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:900});
  await catalogScreenshot(page,testInfo,"shared-dtsi-multifile-missing-1440");
  await page.getByText("构建设置",{exact:true}).click();
  await files.getByRole("button",{name:"library/parts/battery.dtsi",exact:true}).click();
  await expect(page.getByLabel("文件路径",{exact:true})).toHaveValue("library/parts/battery.dtsi");
  await page.getByRole("button",{name:"定位源码：library/main.dtsi:1:1",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("文件路径",{exact:true})).toHaveValue("library/main.dtsi");
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toBeFocused();
  await expect(page.getByLabel("DTSI 源码",{exact:true})).toContainText("missing.dtsi");
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

test("keeps long diagnostics readable and file actions reachable",async({page,catalogAcceptanceRuntime})=>{
  void catalogAcceptanceRuntime;
  await signInCatalogActor(page,"org-admin","/parameter-admin/sources");await dismissXiaozeHint(page);
  await page.getByRole("button",{name:"导入资源",exact:true}).click();
  const missing=`${"long".repeat(32)}.dtsi`;
  await page.locator('input[type="file"]').first().setInputFiles({name:"long-error.dtsi",mimeType:"text/plain",buffer:Buffer.from(`/include/ "${missing}"\n/ {};\n`)});
  await page.getByLabel("变更说明",{exact:true}).fill("验证长路径错误。");
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  const error=page.getByRole("alert");await expect(error).toContainText(missing);
  await page.getByText("构建设置",{exact:true}).click();
  for(const viewport of [{width:1440,height:900},{width:1280,height:800}]) {
    await page.setViewportSize(viewport);
    await error.scrollIntoViewIfNeeded();
    await expect(error).toBeInViewport({ratio:1});
    const locate=error.getByRole("button",{name:"定位源码：long-error.dtsi:1:1",exact:true});
    await expect(locate).toBeInViewport({ratio:1});
    expect(await locate.evaluate(element=>{const rect=element.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return hit===element || element.contains(hit);})).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const path=page.getByLabel("文件路径",{exact:true});
    await path.scrollIntoViewIfNeeded();await path.focus();await page.keyboard.press("Tab");
    await expect(page.getByRole("button",{name:"新建源码",exact:true})).toBeFocused();await page.keyboard.press("Tab");
    const remove=page.getByRole("button",{name:"移除当前文件",exact:true});
    await expect(remove).toBeFocused();
    await expect(page.getByLabel("DTSI 源码",{exact:true})).toBeVisible();
  }
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
