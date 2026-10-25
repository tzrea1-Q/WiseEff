import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import JSZip from "jszip";
import { test } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, dismissXiaozeHint, signInCatalogActor } from "./helpers/catalogBrowser";

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
  await page.getByLabel("变更说明",{exact:true}).fill("保留完整源码与目录，供项目引用。");
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(page.getByText("草稿已保存",{exact:true})).toBeVisible();
  const resourceId=new URL(page.url()).searchParams.get("resource")!;
  const files=page.getByRole("navigation",{name:"资源文件",exact:true});
  await files.getByRole("button",{name:"library/main.dtsi",exact:true}).click();
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("library/main.dtsi:1:1");
  await expect(page.getByRole("alert")).toContainText("missing.dtsi");
  await catalogScreenshot(page,testInfo,"shared-dtsi-multifile-missing-1440");
  await files.getByRole("button",{name:"library/parts/battery.dtsi",exact:true}).click();
  await page.getByLabel("文件路径",{exact:true}).fill("library/parts/missing.dtsi");
  await files.getByRole("button",{name:"library/main.dtsi",exact:true}).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button",{name:"预览发布",exact:true}).click();
  await expect(page.getByRole("heading",{name:"发布 battery-library",exact:true})).toBeVisible();
  await expect(page.getByText("project_host",{exact:true})).toBeVisible();
  await page.getByRole("navigation",{name:"资源文件",exact:true}).getByRole("button",{name:"include/constants.h",exact:true}).click();
  await expect(page.getByLabel("待发布 DTSI 源码",{exact:true})).toContainText("#define VOLTAGE 42");
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
