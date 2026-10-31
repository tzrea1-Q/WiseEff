import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { SharedDtsiPage } from "./SharedDtsiPage";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
function setup(options: { writable?: boolean; saveError?: boolean;dependency?:boolean } = {}) {
  const resourceId = "33333333-3333-4333-8333-333333333333";
  let item: Record<string, unknown> | null = null;
  let state="active",lifecycleRevision=1;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST" && String(_url).endsWith("/import-preview")) return new Response(JSON.stringify({item:{members:[{sourceName:"lib/new.dtsi",content:"/ { new {}; };"}],ignored:["README.md"]}}));
    if(method==="POST"&&String(_url).endsWith("/lifecycle")){
      state=JSON.parse(init!.body as string).state;lifecycleRevision++;
      return new Response(JSON.stringify({item:{resourceId,state,lifecycleRevision,updatedAt:"2026-10-25T00:00:00Z"}}));
    }
    const dependencyId="44444444-4444-4444-8444-444444444444",versionId="55555555-5555-4555-8555-555555555555";
    const version={id:versionId,resourceId:dependencyId,version:3,name:"Common clocks",changeDescription:"Fixed clock source",digest:"sha256:fixed",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author"};
    if(options.dependency&&String(_url).includes(`${dependencyId}/versions/${versionId}`))return new Response(JSON.stringify({item:{...version,members:[{id:versionId,sourceName:"clocks.dtsi",content:"/ {};",checksum:"sha256:fixed",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:versionId,sourceName:"clocks.dtsi",checksum:"sha256:fixed",sizeBytes:5,role:"include"}],externalReferences:[]}}}));
    if(options.dependency&&String(_url).includes(`${dependencyId}/versions`))return new Response(JSON.stringify({items:[version],total:1}));
    if(options.dependency&&String(_url).includes(`${dependencyId}/detail`))return new Response(JSON.stringify({item:{resourceId:dependencyId,name:"Common clocks",updatedAt:version.createdAt,draftRevision:null,currentVersion:version}}));
    if (method === "POST") {
      const input = JSON.parse(init!.body as string);
      item = { id: "11111111-1111-4111-8111-111111111111", resourceId, name: input.name, revision: 1, updatedAt: "2026-10-25T00:00:00Z",
        ...(input.buildInputs ? { buildInputs: input.buildInputs } : {}),
        dependencies:input.dependencies,members: [{ id: "22222222-2222-4222-8222-222222222222", sourceName: input.sourceName, content: input.content }] };
      return new Response(JSON.stringify({ item }), { status: 201 });
    }
    if (method === "PUT" && options.saveError) return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "草稿已被更新，请重新载入后核对；本地修改仍保留。" } }), { status: 409 });
    if (method === "GET" && String(_url).includes(`${resourceId}/detail`)) return new Response(JSON.stringify({item:{resourceId,name:item?.name,
      updatedAt:"2026-10-25T00:00:00Z",state,lifecycleRevision,draftRevision:item?.revision,currentVersion:null}}));
    if (method === "GET" && String(_url).includes(resourceId)) return new Response(JSON.stringify({ item }));
    return new Response(JSON.stringify({ items: options.dependency?[{resourceId:dependencyId,name:"Common clocks",updatedAt:version.createdAt,sourceName:"clock.dtsi",draftRevision:null,currentVersion:version}]:item ? [{ resourceId,name:item.name,updatedAt:item.updatedAt,sourceName:"common.dtsi",draftRevision:item.revision,currentVersion:null }] : [], total: options.dependency||item ? 1 : 0 }));
  });
  const api = createApiClient({ baseUrl: "", fetchImpl });
  function Harness() {
    const [search, setSearch] = useState("");
    return <SharedDtsiPage apiClient={api} canWrite={options.writable ?? true} search={search}
      onNavigate={path => setSearch(new URL(path, "http://localhost").search)} />;
  }
  return { ...render(<Harness />), fetchImpl };
}

describe("shared DTSI draft authoring", () => {
  it("starts with a clear import choice and shows selected files before saving", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", {name:"导入资源"}));
    expect(await screen.findByRole("button", {name:"选择文件"})).toBeVisible();
    expect(screen.getByRole("button", {name:"新建源码"})).toBeVisible();
    expect(screen.queryByLabelText("DTSI 源码")).not.toBeInTheDocument();
    const file = new File(["/ { battery {}; };\n"], "battery.dtsi");
    Object.defineProperty(file, "arrayBuffer", {value: async () => new TextEncoder().encode("/ { battery {}; };\n").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, file);
    expect(await screen.findByLabelText("DTSI 源码")).toHaveTextContent("battery");
    expect(screen.getByLabelText("资源名称")).toHaveValue("battery");
  });
  it("confirms replacement and keeps inspected ZIP members instead of the old editor contents", async () => {
    const user=userEvent.setup(); const {fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const sourceFile=new File(["old"],"old.dtsi");
    Object.defineProperty(sourceFile,"arrayBuffer",{value:async()=>new TextEncoder().encode("/ { old {}; };").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,sourceFile);
    expect(await screen.findByLabelText("DTSI 源码")).toHaveTextContent("old");
    const archive=new File(["zip"],"new.zip",{type:"application/zip"});
    Object.defineProperty(archive,"arrayBuffer",{value:async()=>new TextEncoder().encode("zip").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,archive);
    const confirm=await screen.findByRole("dialog",{name:"替换全部源码？"});
    await user.click(within(confirm).getByRole("button",{name:"替换源码"}));
    expect(await screen.findByLabelText("DTSI 源码")).toHaveTextContent("new");
    expect(screen.getByLabelText("资源名称")).toHaveValue("old");
    expect(screen.getByText("已忽略 1 个非源码文件")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    const request=fetchImpl.mock.calls.find(([url,init])=>init?.method==="POST" && String(url).endsWith("/shared-dtsi"))!;
    expect(JSON.parse(request[1]!.body as string)).toMatchObject({members:[{sourceName:"lib/new.dtsi",content:"/ { new {}; };"}]});
    expect(JSON.parse(request[1]!.body as string)).not.toHaveProperty("archive");
  });
  it("imports a directory with auxiliary files and preserves the existing source when replacement is cancelled", async () => {
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择目录"});
    const sourceFile=new File(["source"],"common.dtsi"),readme=new File(["notes"],"README.md");
    Object.defineProperty(sourceFile,"webkitRelativePath",{value:"library/common.dtsi"});
    Object.defineProperty(sourceFile,"arrayBuffer",{value:async()=>new TextEncoder().encode("/ { original {}; };").buffer});
    Object.defineProperty(readme,"webkitRelativePath",{value:"library/README.md"});
    await user.upload(document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!,[sourceFile,readme]);
    expect(await screen.findByLabelText("DTSI 源码")).toHaveTextContent("original");
    expect(screen.getByLabelText("资源名称")).toHaveValue("library");
    expect(screen.getByText("已忽略 1 个非源码文件")).toBeVisible();
    const other=new File(["other"],"other.dtsi");
    Object.defineProperty(other,"arrayBuffer",{value:async()=>new TextEncoder().encode("/ { replacement {}; };").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,other);
    await user.click(within(await screen.findByRole("dialog",{name:"替换全部源码？"})).getByRole("button",{name:"取消"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original");
    expect(screen.getByLabelText("文件路径")).toHaveValue("library/common.dtsi");
  });
  it("can restore an unpublished retired resource without losing its editable draft",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Recoverable draft");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存",{exact:true});
    await user.click(screen.getByRole("button",{name:"停用资源"}));
    await user.click(within(screen.getByRole("dialog",{name:"停用资源？"})).getByRole("button",{name:"停用资源"}));
    await screen.findByText(/^资源已停用/);expect(screen.getByLabelText("资源名称")).toHaveValue("Recoverable draft");
    expect(screen.queryByRole("button",{name:"预览发布"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"恢复资源"}));
    await user.click(within(screen.getByRole("dialog",{name:"恢复资源？"})).getByRole("button",{name:"恢复资源"}));
    await screen.findByText("资源已恢复，可再次建立新引用。",{exact:true});
    expect(screen.getByLabelText("资源名称")).toHaveValue("Recoverable draft");expect(screen.getByRole("button",{name:"预览发布"})).toBeVisible();
  });
  it("retains declared search roots and external macros and guards settings-only unsaved changes", async () => {
    const user = userEvent.setup();
    const { fetchImpl } = setup();
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"), "Original engineering");
    await user.click(screen.getByText("构建设置", { exact: true }));
    await user.type(screen.getByLabelText("Include 搜索目录"), "include");
    await user.type(screen.getByLabelText("构建宏"), "ENABLED=1");
    await user.click(screen.getByRole("button", { name: /^保存草稿$/u }));
    await screen.findByText("草稿已保存", { exact: true });
    const post = fetchImpl.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ buildInputs: { includeSearchPaths: ["include"], defines: { ENABLED: "1" } } });
    expect(screen.getByLabelText("构建宏")).toHaveValue("ENABLED=1");
    await user.clear(screen.getByLabelText("构建宏"));
    await user.type(screen.getByLabelText("构建宏"), "ENABLED=0");
    expect(screen.getByRole("button", { name: /^保存草稿$/u })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "返回资源列表" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("reveals fixed dependencies only when requested and retains them in draft saves",async()=>{
    const user=userEvent.setup();const {fetchImpl}=setup({dependency:true});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Complete resource");
    await user.click(screen.getByText("固定资源依赖（按需）"));
    await screen.findByText("尚未选择固定资源依赖。");
    expect(screen.getByLabelText("依赖挂载目录")).toBeVisible();
    await user.click(await screen.findByRole("combobox",{name:"依赖资源"}));
    await user.click(await screen.findByRole("option",{name:"Common clocks"}));
    await user.click(await screen.findByRole("combobox",{name:"依赖固定版本"}));
    await user.click(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"}));
    await user.type(screen.getByLabelText("依赖挂载目录"),"vendor/clocks");
    await user.click(screen.getByRole("button",{name:"添加固定依赖"}));
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    const request=fetchImpl.mock.calls.find(([,init])=>init?.method==="POST")!;
    expect(JSON.parse(request[1]!.body as string).dependencies).toEqual([{resourceId:"44444444-4444-4444-8444-444444444444",versionId:"55555555-5555-4555-8555-555555555555",mountPath:"vendor/clocks"}]);
    expect(await screen.findByText("Common clocks · 版本 3 · vendor/clocks")).toBeVisible();
    expect(screen.getByRole("link",{name:"查看固定依赖 1 源码"})).toHaveAttribute("href",expect.stringContaining("version=55555555-5555-4555-8555-555555555555"));
  });
  it("keeps relative file paths and unsaved editor content while switching source members",async()=>{
    const user=userEvent.setup();
    const {fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    const files=[new File(['/include/ "parts/node.dtsi"\n'],"main.dtsi"),new File(['/ { node {}; };\n'],"node.dtsi"),new File(["#define VALUE 42\n"],"constants.h")];
    files.forEach((file,index)=>{Object.defineProperty(file,"webkitRelativePath",{value:["lib/main.dtsi","lib/parts/node.dtsi","headers/constants.h"][index]});
      Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode([ '/include/ "parts/node.dtsi"\n','/ { node {}; };\n',"#define VALUE 42\n"][index]!).buffer});});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    await user.click(await screen.findByRole("button",{name:"headers/constants.h"}));
    expect(screen.getByLabelText("文件路径")).toHaveValue("headers/constants.h");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("#define VALUE 42");
    await user.type(screen.getByLabelText("文件路径"),"pp");
    await user.click(screen.getByRole("button",{name:"lib/main.dtsi"}));
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    const request=fetchImpl.mock.calls.find(([,init])=>init?.method==="POST")!;
    expect(JSON.parse(request[1]!.body as string).members).toEqual([
      {sourceName:"lib/main.dtsi",content:'/include/ "parts/node.dtsi"\n'},
      {sourceName:"lib/parts/node.dtsi",content:'/ { node {}; };\n'},
      {sourceName:"headers/constants.hpp",content:"#define VALUE 42\n"}
    ]);
  });
  it("saves a draft and preserves edited input when a later save conflicts", async () => {
    const user = userEvent.setup();
    setup({ saveError: true });
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"), "Battery common");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("草稿已保存");
    await user.type(screen.getByLabelText("资源名称"), " changed");
    const event = new Event("beforeunload", { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "返回资源列表" }));
    await screen.findByRole("dialog", { name: "放弃未保存的更改？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeVisible();
    expect(screen.getByRole("button", { name: "丢弃草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    await screen.findByRole("dialog", { name: "重新载入草稿？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
  });

  it("does not offer draft mutations to a resource reader", async () => {
    setup({ writable: false });
    await screen.findByText("尚无共享 DTSI");
    expect(screen.queryByRole("button", { name: "导入资源" })).not.toBeInTheDocument();
  });

  it("ignores a file read that finishes after leaving and opening another draft", async () => {
    const user=userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    let finish!: (value:ArrayBuffer)=>void;
    const file=new File(["ignored"],"old-source.dtsi",{type:"text/plain"});
    Object.defineProperty(file,"arrayBuffer",{value:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,file);
    await user.click(screen.getByRole("button",{name:"返回资源列表"}));
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"New current draft");
    await act(async()=>{finish(new TextEncoder().encode('/ { old { status = "disabled"; }; };').buffer);});
    expect(screen.getByLabelText("资源名称")).toHaveValue("New current draft");
    expect(screen.getByLabelText("文件路径")).toHaveValue("common.dtsi");
  });

  it("restores an exact historical member and a project node return link", async () => {
    const resourceId="33333333-3333-4333-8333-333333333333",versionId="44444444-4444-4444-8444-444444444444";
    const member={id:"22222222-2222-4222-8222-222222222222",sourceName:"battery.dtsi",content:'/ { battery { status = "disabled"; }; };',checksum:"sha256:source",sizeBytes:40};
    const summary={id:versionId,resourceId,version:1,name:"Historical source",changeDescription:"Original",digest:"sha256:version",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author"};
    const first={...member,id:"77777777-7777-4777-8777-777777777777",sourceName:"first.dtsi",content:"/ { first {}; };"};
    const version={...summary,manifest:{schemaVersion:"shared-dtsi/v1",members:[first,member].map(({content:_,...row})=>({...row,role:"include"})),externalReferences:[]},members:[first,member]};
    const api=createApiClient({baseUrl:"",fetchImpl:async(url)=>new Response(JSON.stringify({item:String(url).endsWith("/detail")
      ? {resourceId,name:summary.name,updatedAt:summary.createdAt,draftRevision:null,currentVersion:{...summary,id:"88888888-8888-4888-8888-888888888888",version:2}}
      : version}),{status:200})});
    const context="/parameter-admin/projects/project/configuration?organization=org&configSet=config&revision=revision&file=file&version=source-v1&node=%2Fbattery&tab=source";
    const search=`?${new URLSearchParams({resource:resourceId,version:versionId,member:member.id,line:"1",projectContext:context})}`;
    render(<SharedDtsiPage apiClient={api} canWrite organizationId="org" search={search} onNavigate={()=>{}} />);
    await screen.findByText("v1 · 历史版本，只读");
    expect(screen.getByLabelText("已发布 DTSI 源码")).toHaveTextContent("battery");
    expect(screen.getByLabelText("已发布 DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.getByRole("link",{name:"返回项目节点"})).toHaveAttribute("href",context);
    expect(screen.queryByRole("button",{name:"保存草稿"})).not.toBeInTheDocument();
  });

  it("publishes a preview, reads immutable history, and discards only the next draft", async () => {
    const user=userEvent.setup();
    const resourceId="33333333-3333-4333-8333-333333333333",versionId="44444444-4444-4444-8444-444444444444";
    const member={id:"22222222-2222-4222-8222-222222222222",sourceName:"battery.dtsi",content:'/ { battery { compatible = "test,battery"; status = "disabled"; }; };',checksum:"sha256:source",sizeBytes:77};
    const summary={id:versionId,resourceId,version:1,name:"Battery common",changeDescription:"首次共享版本",digest:"sha256:version",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author"};
    const manifest={schemaVersion:"shared-dtsi/v1",members:[{id:member.id,sourceName:member.sourceName,checksum:member.checksum,sizeBytes:member.sizeBytes,role:"include"}],externalReferences:[]};
    const version={...summary,manifest,members:[member]};
    let published=false,hasDraft=true;
    const api=createApiClient({baseUrl:"",fetchImpl:async(url,init)=>{
      const path=new URL(String(url),"http://localhost").pathname,method=init?.method??"GET";
      let response:unknown;
      if (method==="GET" && path.endsWith("/detail")) response={item:{resourceId,name:summary.name,updatedAt:summary.createdAt,draftRevision:hasDraft?1:null,currentVersion:published?summary:null}};
      else if (method==="GET" && path.endsWith("/versions")) response={items:published?[summary]:[],total:published?1:0};
      else if (method==="GET" && path.endsWith(`/versions/${versionId}`)) response={item:version};
      else if (method==="POST" && path.endsWith("/publication-preview")) response={item:{id:"55555555-5555-4555-8555-555555555555",resourceId,draftRevision:1,name:summary.name,changeDescription:summary.changeDescription,manifest,digest:summary.digest,createdAt:summary.createdAt,baseVersionId:null,
        comparison:{before:null,sources:[{resourceId,resourceName:summary.name,memberId:member.id,before:null,after:{sourceName:member.sourceName,content:member.content}}],buildInputs:{before:{includeSearchPaths:[],defines:{}},after:{includeSearchPaths:[],defines:{}}},dependencies:{before:[],after:[]},semantic:{scope:"ordered-fragment-declarations",before:"",after:member.content,externalReferences:[]}}}};
      else if (method==="POST" && path.endsWith("/publications")) {published=true;hasDraft=false;response={item:version};}
      else if (method==="POST" && path.endsWith("/draft")) {hasDraft=true;response={item:{id:"66666666-6666-4666-8666-666666666666",resourceId,name:summary.name,revision:1,updatedAt:summary.createdAt,changeDescription:"",members:[{id:member.id,sourceName:member.sourceName,content:member.content}]}};}
      else if (method==="DELETE" && path.endsWith("/draft")) {hasDraft=false;response={ok:true};}
      else response={item:{id:"11111111-1111-4111-8111-111111111111",resourceId,name:summary.name,revision:1,updatedAt:summary.createdAt,changeDescription:published?"":summary.changeDescription,members:[{id:member.id,sourceName:member.sourceName,content:member.content}]}};
      return new Response(JSON.stringify(response),{status:200});
    }});
    function Harness(){const[search,setSearch]=useState(`?resource=${resourceId}`);return <SharedDtsiPage apiClient={api} canWrite search={search} onNavigate={path=>setSearch(new URL(path,"http://localhost").search)}/>;}
    render(<Harness/>);
    await user.click(await screen.findByRole("button",{name:"预览发布"}));
    expect(screen.getByText("本组织有查看权限的用户可读取完整源码；发布不会自动更新项目配置。")).toBeVisible();
    expect(screen.getByLabelText("首次发布 → 待发布版本")).toBeVisible();
    await user.click(screen.getByRole("radio",{name:"语义声明"}));
    expect(screen.getByLabelText("有序语义声明变更后")).toHaveTextContent("battery");
    await user.click(screen.getByRole("button",{name:"发布版本"}));
    await screen.findByText("v1 · 已发布，只读");
    expect(screen.getByLabelText("已发布 DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.queryByRole("button",{name:"保存草稿"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab",{name:"版本"}));
    await user.click(await screen.findByRole("button",{name:"v1"}));
    await user.click(await screen.findByRole("button",{name:"创建新版本"}));
    await screen.findByLabelText("变更说明");
    await user.click(screen.getByRole("button",{name:"丢弃草稿"}));
    const dialog=await screen.findByRole("dialog",{name:"丢弃共享 DTSI 草稿？"});
    expect(dialog).toHaveTextContent("已发布版本和历史会保留");
    await user.click(within(dialog).getByRole("button",{name:"丢弃草稿"}));
    await screen.findByText("v1 · 已发布，只读");
    expect(published).toBe(true);
  });
});
