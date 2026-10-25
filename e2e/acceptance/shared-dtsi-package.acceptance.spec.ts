import "./helpers/loadAcceptanceEnvironment";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect } from "playwright/test";
import { test, catalogAppUrl } from "./helpers/catalogFixtureRuntime";
import { catalogJson, signInCatalogActor, dismissXiaozeHint, assertNoPageOverflow } from "./helpers/catalogBrowser";
import { acceptanceCast } from "./helpers/cast";
import { configSetPackageManifestName, type ConfigSetImportResult } from "../../server/modules/contracts/dtoSchemas/configSetPackage";
import type { ExportConfigSetResult } from "../../server/modules/parameter-files/exportService";
import type { ThemePreference } from "../../src/application/theme/themeController";

test.use({catalogRuntimeScope:import.meta.url,catalogRuntimeDatabaseUrl:process.env.TEST_DATABASE_URL});

test("#1427 exports original complete sources and imports them into a normally approved empty project",async({page,catalogAcceptanceRuntime},testInfo)=>{
  test.setTimeout(180_000);void catalogAcceptanceRuntime;
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const sourceName="boards/vendor/long-hardware-product-original-sources/board.dts";
  const source='\uFEFF/dts-v1/;\r\n// preserved original project override\r\n/ { model = "Package browser"; compatible = "test,board"; battery { limit = <31>; status = "disabled"; }; };\r\n';
  const json='{\r\n  "feature": true, "nested": {"mode":"production"}\r\n}\r\n';
  const post=async(path:string,data:unknown)=>{const response=await catalogJson(page.request,"POST",path,{data});expect(response.status,JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);expect(response.status,JSON.stringify(response.body)).toBeLessThan(300);return response.body as {item:Record<string,string>};};
  async function createProject(id:string,code:string) {
    await post("/api/v1/parameters/admin/projects",{id,name:code,code});
    const draft=await catalogJson(page.request,"PUT",`/api/v1/parameters/projects/${id}/initialization/draft`,{data:{projectName:code,projectCode:code,
      ownerUserId:acceptanceCast.acceptanceAdmin.userId,sourceProjectIds:[],primarySourceProjectId:null,supplementSourceProjectIds:[],selectedModuleIds:[],selectedRisks:[],
      selectedSourceBindingIds:[],bindingSnapshots:[],emptyLibrary:true,notes:"Normal empty project approval before original source package import"}});expect(draft.status,JSON.stringify(draft.body)).toBe(200);
    const review=await post(`/api/v1/parameters/projects/${id}/initialization/submit`,{});
    await post(`/api/v1/parameters/admin/initialization-reviews/${review.item.id}/approve`,{});
  }
  const initial=new JSZip();initial.file(sourceName,source,{createFolders:false});initial.file("private/settings.json",json,{createFolders:false});
  initial.file(configSetPackageManifestName,JSON.stringify({projectId:"untrusted-original-project",sourcePackage:{schemaVersion:"wiseeff-config-set/v1",entryFile:sourceName,
    includeSearchPaths:["."],overlayOrder:[],declaredBuildInputs:{includeSearchPaths:["."],defines:{}},resolvedBuildInputs:{includeSearchPaths:["."],defines:{}},sharedClosure:[],jsonSources:[],
    members:[{sourceName,format:"dts",role:"base",sortOrder:0,checksum:`sha256:${createHash("sha256").update(source).digest("hex")}`},
      {sourceName:"private/settings.json",format:"json",role:"thermal",sortOrder:1,checksum:`sha256:${createHash("sha256").update(json).digest("hex")}`}]}}));
  const prefix=`t16-${Date.now().toString(36)}`,from=`${prefix}-source`,target=`${prefix}-new`;
  await createProject(from,"T16SRC");await createProject(target,"T16NEW");
  const seedBody={name:"Original package",ownership:"private",archive:{name:"original.zip",contentBase64:await initial.generateAsync({type:"base64"})}};
  const initialPreview=await post(`/api/v1/projects/${from}/config-set-import/preview`,seedBody);
  const seeded=await post(`/api/v1/projects/${from}/config-set-import/apply`,{...seedBody,proofToken:initialPreview.item.proofToken,reason:"Prepare actual source project",clientMutationId:"browser-original-package"});
  const draft=await post("/api/v2/shared-dtsi",{name:"Reusable battery source",sourceName:"library/long-compatible-hardware-reference/battery.dtsi",
    content:'/ { battery { limit = <28>; status = "okay"; }; shared_only { active = <1>; }; };\n',changeDescription:"Independent shared original"});
  const publication=await post(`/api/v2/shared-dtsi/${draft.item.resourceId}/publication-preview`,{expectedRevision:1});
  const published=await post(`/api/v2/shared-dtsi/${draft.item.resourceId}/publications`,{previewId:publication.item.id,idempotencyKey:"browser-package-shared"});
  const addition={role:"misc",sortOrder:2,sharedReference:{resourceId:draft.item.resourceId,versionId:published.item.id,mountPath:"shared/original"}};
  const additionPath=`/api/v1/projects/${from}/config-sets/${seeded.item.configSetId}/member-addition`;
  const additionPreview=await post(`${additionPath}/preview`,addition);
  await post(`${additionPath}/apply`,{...addition,proofToken:additionPreview.item.proofToken,reason:"Compose shared input before export",clientMutationId:"browser-package-reference"});
  const expectedResponse=await catalogJson(page.request,"GET",`/api/v1/projects/${from}/config-sets/${seeded.item.configSetId}/export`);expect(expectedResponse.status).toBe(200);
  const expected=expectedResponse.body as ExportConfigSetResult;
  await page.setViewportSize({width:1440,height:900});
  await signInCatalogActor(page,"org-admin",`/parameter-admin/projects/${from}/configuration?configSet=${seeded.item.configSetId}`);await dismissXiaozeHint(page);
  await page.getByRole("button",{name:"配置",exact:true}).click();
  const downloading=page.waitForEvent("download");await page.getByRole("menuitem",{name:"导出当前配置",exact:true}).click();
  const downloaded=await downloading,path=await downloaded.path();expect(path).not.toBeNull();const bytes=await readFile(path!);
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  expect(await zip.file("private/settings.json")!.async("string")).toBe(json);
  expect(await zip.file(sourceName)!.async("string")).toBe(expected.files.find(row=>row.name===sourceName)!.content);
  await page.goto(catalogAppUrl(`/parameter-admin/projects/${target}/configuration`));
  await page.getByRole("button",{name:"配置",exact:true}).click();
  await page.getByRole("menuitem",{name:"导入完整配置…",exact:true}).focus();await page.keyboard.press("Enter");
  const dialog=page.getByRole("dialog",{name:"导入完整配置",exact:true});
  await expect(dialog).toBeVisible();await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"配置",exact:true})).toBeFocused();
  await page.keyboard.press("Enter");await page.getByRole("menuitem",{name:"导入完整配置…",exact:true}).click();await expect(dialog).toBeVisible();
  await dialog.getByLabel("配置包",{exact:true}).setInputFiles({name:downloaded.suggestedFilename(),mimeType:"application/zip",buffer:bytes});
  await dialog.getByRole("textbox",{name:"配置名称",exact:true}).fill("Reproduced original package");
  const previewPath=`**/api/v1/projects/${target}/config-set-import/preview`;
  await page.route(previewPath,route=>route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({error:{code:"VALIDATION_FAILED",message:"请重新预览以验证当前共享版本。",details:{},requestId:"t16-preview-recovery"}})}),{times:1});
  await dialog.getByRole("button",{name:"预览导入",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText("重新预览");
  await expect(dialog.getByRole("textbox",{name:"配置名称",exact:true})).toHaveValue("Reproduced original package");
  await page.screenshot({path:testInfo.outputPath("package-recovery-1440.png")});
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(previewPath,async route=>{await held;await route.continue();},{times:1});
  await dialog.getByRole("button",{name:"预览导入",exact:true}).click();
  await expect(dialog.getByRole("status")).toContainText("正在验证");
  await page.screenshot({path:testInfo.outputPath("package-loading-1440.png")});release();
  await expect(dialog.getByLabel("配置导入预览")).toContainText("共享只读");
  await dialog.getByRole("textbox",{name:"导入原因",exact:true}).fill("Reproduce original source bytes and exact shared version");
  for(const viewport of [{width:1440,height:900},{width:1280,height:800}]) {
    await page.setViewportSize(viewport);await assertNoPageOverflow(page);
    await expect(dialog.getByRole("button",{name:"确认导入",exact:true})).toBeInViewport({ratio:1});
    await page.screenshot({path:testInfo.outputPath(`package-preview-${viewport.width}.png`)});
  }
  await page.evaluate((theme:ThemePreference)=>{if(!window.__wiseeffSetTheme)throw new Error("Theme controller is unavailable");window.__wiseeffSetTheme(theme);},"dark" as ThemePreference);
  await expect(page.locator("html")).toHaveCSS("color-scheme","dark");
  await expect(dialog.getByRole("textbox",{name:"配置名称",exact:true})).not.toHaveCSS("color","rgb(0, 0, 0)");
  await page.screenshot({path:testInfo.outputPath("package-preview-dark-1280.png")});
  const applying=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname===`/api/v1/projects/${target}/config-set-import/apply`);
  await dialog.getByRole("button",{name:"确认导入",exact:true}).focus();await page.keyboard.press("Enter");
  const applied=await applying;expect(applied.status(),await applied.text()).toBe(200);const receipt=(await applied.json()).item as ConfigSetImportResult;
  await expect(dialog).toHaveCount(0);await page.reload();
  const actualResponse=await catalogJson(page.request,"GET",`/api/v1/projects/${target}/config-sets/${receipt.configSetId}/export`);expect(actualResponse.status).toBe(200);
  const actual=actualResponse.body as ExportConfigSetResult;expect(actual.files).toEqual(expected.files);expect(actual.manifest.sourcePackage).toEqual(expected.manifest.sourcePackage);
  expect(actual.manifest.projectId).toBe(target);expect(actual.manifest.members.map(row=>row.fileId)).not.toEqual(expected.manifest.members.map(row=>row.fileId));
  await page.getByRole("tab",{name:"生效配置",exact:true}).click();await page.getByRole("treeitem",{name:"节点 /battery",exact:true}).click();
  await expect(page.getByLabel("limit 最终值",{exact:true})).toHaveText("<31>");await expect(page.getByText("节点未启用（disabled） · 不可达",{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("package-effective-dark-1280.png")});
  const shared=actual.manifest.members.find(row=>row.sharedReference)!;
  await page.goto(catalogAppUrl(`/parameter-admin/projects/${target}/configuration?${new URLSearchParams({configSet:receipt.configSetId,file:shared.fileId})}`));
  await expect(page.getByRole("region",{name:"DTS 源码",exact:true})).toContainText("shared_only");
  await expect(page.getByRole("radio",{name:"编辑",exact:true})).toHaveCount(0);await page.screenshot({path:testInfo.outputPath("package-shared-readonly-1280.png")});
  expect(errors).toEqual([]);
});
