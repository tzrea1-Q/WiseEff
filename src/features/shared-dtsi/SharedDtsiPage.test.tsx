import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { SharedDtsiPage } from "./SharedDtsiPage";
import { SharedDtsiDependencies } from "./SharedDtsiDependencies";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
function setup(options: { writable?: boolean; saveError?: boolean;dependency?:boolean; draftOnly?:boolean; pagination?:boolean; failSearch?:Promise<void>; failVersions?:boolean; failPinnedVersion?:boolean } = {}) {
  const resourceId = "33333333-3333-4333-8333-333333333333";
  let item: Record<string, unknown> | null = null;
  let state="active",lifecycleRevision=1, searchFailed=false, versionsFailed=false, pinnedFailed=false;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST" && String(_url).endsWith("/import-preview")) return new Response(JSON.stringify({item:{members:[{sourceName:"lib/new.dtsi",content:"/ { new {}; };"}],ignored:["README.md"]}}));
    if(method==="POST"&&String(_url).endsWith("/lifecycle")){
      state=JSON.parse(init!.body as string).state;lifecycleRevision++;
      return new Response(JSON.stringify({item:{resourceId,state,lifecycleRevision,updatedAt:"2026-10-25T00:00:00Z"}}));
    }
    const dependencyId="44444444-4444-4444-8444-444444444444",versionId="55555555-5555-4555-8555-555555555555";
    const version={id:versionId,resourceId:dependencyId,version:3,name:"Common clocks",changeDescription:"Fixed clock source",digest:"sha256:fixed",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author"};
    if(options.dependency&&String(_url).includes(`${dependencyId}/versions/${versionId}`)){
      if(options.failPinnedVersion&&!pinnedFailed){pinnedFailed=true;return new Response(JSON.stringify({error:{code:"INTERNAL_ERROR",message:"固定版本读取失败"}}),{status:503});}
      return new Response(JSON.stringify({item:{...version,members:[{id:versionId,sourceName:"clocks.dtsi",content:"/ {};",checksum:"sha256:fixed",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:versionId,sourceName:"clocks.dtsi",checksum:"sha256:fixed",sizeBytes:5,role:"include"}],externalReferences:[]}}}));
    }
    if(options.dependency&&String(_url).includes(`${dependencyId}/versions`)) {
      if(options.failVersions&&!versionsFailed){versionsFailed=true;return new Response(JSON.stringify({error:{code:"INTERNAL_ERROR",message:"版本读取失败"}}),{status:503});}
      return new Response(JSON.stringify({items:[version],total:1}));
    }
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
    if (method === "GET" && new URL(String(_url),"http://localhost").pathname.includes(resourceId)) return new Response(JSON.stringify({ item }));
    if(options.failSearch && !searchFailed && new URL(String(_url),"http://localhost").searchParams.get("q")==="Common") {
      searchFailed=true; await options.failSearch;
      return new Response(JSON.stringify({error:{code:"INTERNAL_ERROR",message:"资源搜索失败"}}),{status:503});
    }
    if (options.pagination) {
      const params = new URL(String(_url), "http://localhost").searchParams;
      const names = Array.from({length: 21}, (_, index) => `Resource ${index + 1}`).filter(name => name.toLowerCase().includes((params.get("q") ?? "").toLowerCase()));
      const offset = Number(params.get("offset") ?? 0);
      return new Response(JSON.stringify({items: names.slice(offset, offset + 20).map((name, index) => ({resourceId:`${String(index + offset + 1).padStart(8,"0")}-4444-4444-8444-444444444444`,name,updatedAt:version.createdAt,sourceName:"clock.dtsi",draftRevision:null,currentVersion:version})),total:names.length}));
    }
    return new Response(JSON.stringify({ items: options.draftOnly ? [{resourceId:dependencyId,name:"Unpublished",updatedAt:version.createdAt,sourceName:"clock.dtsi",draftRevision:1,currentVersion:null}] : options.dependency?[{resourceId:dependencyId,name:"Common clocks",updatedAt:version.createdAt,sourceName:"clock.dtsi",draftRevision:null,currentVersion:version}]:item ? [{ resourceId,name:item.name,updatedAt:item.updatedAt,sourceName:"common.dtsi",draftRevision:item.revision,currentVersion:null }] : [], total: options.draftOnly||options.dependency||item ? 1 : 0 }));
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
  it("rejects malformed and duplicate build macros without saving",async()=>{
    const user=userEvent.setup(),{fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Platform");
    await user.click(screen.getByText("构建设置"));
    const macros=screen.getByLabelText("预处理宏");
    await user.type(macros,"ENABLED");await user.click(screen.getByRole("button",{name:"保存草稿"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("预处理宏每行填写 NAME=value。");
    await user.clear(macros);await user.type(macros,"ENABLED=1{enter}ENABLED=0");await user.click(screen.getByRole("button",{name:"保存草稿"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("预处理宏名称重复，请保留一个明确的值。");
    expect(fetchImpl.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  });
  it("distinguishes same-name, same-version references by mount path and position", async () => {
    const user=userEvent.setup(),onChange=vi.fn();
    const paths=["vendor/shared","vendor/shared","","","vendor/other"];
    const pins=paths.map((mountPath,index)=>({resourceId:`${String(index+11).padStart(8,"0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,versionId:`${String(index+1).padStart(8,"0")}-1111-4111-8111-111111111111`,mountPath}));
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const pin=pins.find(item=>String(url).includes(item.versionId))!;
      return new Response(JSON.stringify({item:{id:pin.versionId,resourceId:pin.resourceId,version:3,name:"共同资源",changeDescription:"版本说明",digest:"sha256:fixed",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author",
        members:[{id:pin.versionId,sourceName:"source.dtsi",content:"/ {};",checksum:"sha256:fixed",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:pin.versionId,sourceName:"source.dtsi",checksum:"sha256:fixed",sizeBytes:5,role:"include"}],externalReferences:[]}}}));
    });
    const client=createSharedDtsiClient(createApiClient({baseUrl:"",fetchImpl}));
    render(<SharedDtsiDependencies client={client} value={pins} onChange={onChange} disabled={false} sourceHref={(resourceId,versionId)=>`/sources?resource=${resourceId}&version=${versionId}`} />);
    expect(screen.getByText("引用其他共享资源").closest("details")).not.toHaveAttribute("open");
    await user.click(screen.getByText("引用其他共享资源"));
    const first=await screen.findByRole("link",{name:"查看 共同资源 · 版本 3 · vendor/shared · 第 1 项 源码"});
    expect(await screen.findByRole("link",{name:"查看 共同资源 · 版本 3 · vendor/shared · 第 2 项 源码"})).toHaveAttribute("href",expect.stringContaining(pins[1]!.versionId));
    expect(await screen.findByRole("link",{name:"查看 共同资源 · 版本 3 · 资源根目录 · 第 3 项 源码"})).toBeVisible();
    expect(await screen.findByRole("link",{name:"查看 共同资源 · 版本 3 · 资源根目录 · 第 4 项 源码"})).toBeVisible();
    expect(await screen.findByRole("link",{name:"查看 共同资源 · 版本 3 · vendor/other 源码"})).toBeVisible();
    first.focus();await user.tab();
    expect(screen.getByRole("button",{name:"移除 共同资源 · 版本 3 · vendor/shared · 第 1 项"})).toHaveFocus();
    await user.keyboard("{Enter}");expect(onChange).toHaveBeenCalledWith(pins.slice(1));
  });
  it("distinguishes actions for multiple fixed references, including long names", async () => {
    const user=userEvent.setup(),onChange=vi.fn();
    const pins=[{resourceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",versionId:"11111111-1111-4111-8111-111111111111",mountPath:"vendor/common"},
      {resourceId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",versionId:"22222222-2222-4222-8222-222222222222",mountPath:""}];
    const names=["VeryLongSharedResourceNameWithoutSpacesThatMustRemainReadable", "Other resource"];
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const index=String(url).includes(pins[0]!.versionId)?0:1,pin=pins[index]!;
      return new Response(JSON.stringify({item:{id:pin.versionId,resourceId:pin.resourceId,version:index+1,name:names[index],changeDescription:"版本说明",digest:"sha256:fixed",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author",
        members:[{id:pin.versionId,sourceName:"source.dtsi",content:"/ {};",checksum:"sha256:fixed",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:pin.versionId,sourceName:"source.dtsi",checksum:"sha256:fixed",sizeBytes:5,role:"include"}],externalReferences:[]}}}));
    });
    const client=createSharedDtsiClient(createApiClient({baseUrl:"",fetchImpl}));
    render(<SharedDtsiDependencies client={client} value={pins} onChange={onChange} disabled={false} sourceHref={(resourceId,versionId)=>`/sources?resource=${resourceId}&version=${versionId}`} />);
    await user.click(screen.getByText("引用其他共享资源"));
    const first=await screen.findByRole("link",{name:`查看 ${names[0]} · 版本 1 · vendor/common 源码`});
    const second=await screen.findByRole("link",{name:`查看 ${names[1]} · 版本 2 · 资源根目录 源码`});
    expect(second).toHaveAttribute("href",expect.stringContaining(pins[1]!.versionId));
    first.focus();await user.tab();
    const remove=screen.getByRole("button",{name:`移除 ${names[0]} · 版本 1 · vendor/common`});
    expect(remove).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith([pins[1]]);
  });
  it("explains the publication requirement next to an empty saved description", async () => {
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Resource");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    expect(screen.getByLabelText("变更说明")).toHaveAccessibleDescription("发布前请填写变更说明。");
    expect(screen.getByRole("button",{name:"预览发布"})).toBeDisabled();
    await user.type(screen.getByLabelText("变更说明"),"首次发布");
    expect(screen.queryByText("发布前请填写变更说明。")).not.toBeInTheDocument();
  });
  it("loads failing pinned versions once each and stops old work on a scope change", async () => {
    let release!: () => void;
    const waiting=new Promise<void>(resolve=>{release=resolve;});
    const fetchImpl=vi.fn(async (url:string|URL|Request)=>{
      if(String(url).includes("11111111-1111-4111-8111-111111111111"))await waiting;
      return new Response(JSON.stringify({error:{code:"INTERNAL_ERROR",message:"读取失败"}}),{status:503});
    });
    const client=createSharedDtsiClient(createApiClient({baseUrl:"",fetchImpl}));
    const pins=[{resourceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",versionId:"11111111-1111-4111-8111-111111111111",mountPath:""},
      {resourceId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",versionId:"22222222-2222-4222-8222-222222222222",mountPath:""}];
    const view=render(<SharedDtsiDependencies client={client} value={pins} onChange={()=>{}} disabled={false} />);
    await waitFor(()=>expect(fetchImpl).toHaveBeenCalledTimes(1));
    await act(async()=>release());
    await waitFor(()=>expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes(pins[1]!.versionId))).toHaveLength(1));
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes(pins[0]!.versionId))).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes(pins[1]!.versionId))).toHaveLength(1);
    view.unmount();

    let finishOld!: () => void;
    const oldRequest=new Promise<void>(resolve=>{finishOld=resolve;});
    const oldFetch=vi.fn(async()=>{await oldRequest;return new Response(JSON.stringify({error:{code:"INTERNAL_ERROR",message:"读取失败"}}),{status:503});});
    const oldClient=createSharedDtsiClient(createApiClient({baseUrl:"",fetchImpl:oldFetch}));
    const oldView=render(<SharedDtsiDependencies client={oldClient} value={pins} onChange={()=>{}} disabled={false} />);
    await waitFor(()=>expect(oldFetch).toHaveBeenCalledTimes(1));
    oldView.rerender(<SharedDtsiDependencies client={oldClient} value={[]} onChange={()=>{}} disabled={false} />);
    await act(async()=>{finishOld();await oldRequest;});
    expect(oldFetch).toHaveBeenCalledTimes(1);
  });
  it("retries a failed pinned-version lookup after reopening a saved draft", async () => {
    const user=userEvent.setup(); const {fetchImpl}=setup({dependency:true,failPinnedVersion:true});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Platform");
    await user.click(screen.getByText("引用其他共享资源"));
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));
    await user.click(await screen.findByRole("button",{name:"Common clocks"}));
    await user.click(await screen.findByRole("combobox",{name:"版本"}));
    await user.click(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"}));
    await user.click(screen.getByRole("button",{name:"添加引用"}));
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await user.click(await screen.findByText("引用其他共享资源"));
    expect(await screen.findByRole("alert")).toHaveTextContent("固定版本读取失败");
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));
    await screen.findByText("暂无可引用的已发布资源。");
    const listUrl=new URL(String(fetchImpl.mock.calls.filter(([url])=>new URL(String(url),"http://localhost").pathname==="/api/v2/shared-dtsi").at(-1)![0]),"http://localhost");
    expect(listUrl.searchParams.get("eligible")).toBe("1");
    expect(listUrl.searchParams.get("exclude")?.split(",")).toEqual(["33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444"]);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alert")).toHaveTextContent("固定版本读取失败");
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes("/versions/55555555-5555-4555-8555-555555555555"))).toHaveLength(1);
    await user.click(screen.getByRole("button",{name:/重试/}));
    expect(await screen.findByText("Common clocks · 版本 3 · 资源根目录")).toBeVisible();
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes("/versions/55555555-5555-4555-8555-555555555555"))).toHaveLength(2);
  });
  it("hides previous results during failed searches and restores the picker on retry", async () => {
    let release!:()=>void; const waiting=new Promise<void>(resolve=>{release=resolve;});
    const user=userEvent.setup(); setup({dependency:true,failSearch:waiting});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.click(await screen.findByText("引用其他共享资源"));
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));
    await screen.findByRole("button",{name:"Common clocks"});
    await user.click(screen.getByRole("searchbox",{name:"搜索共享资源"}));
    await user.paste("Common");
    expect(await screen.findByText("正在加载共享资源…")).toBeVisible();
    expect(screen.queryByRole("button",{name:"Common clocks"})).not.toBeInTheDocument();
    await act(async()=>release());
    expect(await screen.findByRole("alert")).toHaveTextContent("资源搜索失败");
    expect(screen.queryByRole("button",{name:"Common clocks"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"重试"}));
    expect(await screen.findByRole("button",{name:"Common clocks"})).toBeVisible();
  });
  it("retains a version-load error when the resource picker is opened and retries it", async () => {
    const user=userEvent.setup(); setup({dependency:true,failVersions:true});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.click(await screen.findByText("引用其他共享资源"));
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));
    await user.click(await screen.findByRole("button",{name:"Common clocks"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("版本读取失败");
    await user.click(screen.getByRole("button",{name:"共享资源：Common clocks"}));
    await user.click(await screen.findByRole("button",{name:"Common clocks"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("版本读取失败");
    await user.click(screen.getByRole("button",{name:"重试"}));
    await user.click(await screen.findByRole("combobox",{name:"版本"}));
    expect(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"})).toBeVisible();
  });
  it("retains the version when the same resource is selected again", async () => {
    const user = userEvent.setup(); setup({ dependency: true });
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.click(await screen.findByRole("button", { name: "新建源码" }));
    await user.click(await screen.findByText("引用其他共享资源"));
    await user.click(screen.getByRole("button", { name: "选择共享资源" }));
    await user.click(await screen.findByRole("button", { name: "Common clocks" }));
    await user.click(await screen.findByRole("combobox", { name: "版本" }));
    await user.click(await screen.findByRole("option", { name: "版本 3 · Fixed clock source" }));
    await user.click(screen.getByRole("button", { name: "共享资源：Common clocks" }));
    await user.click(await screen.findByRole("button", { name: "Common clocks" }));
    expect(screen.getByRole("button", { name: "添加引用" })).toBeEnabled();
    await user.click(screen.getByRole("combobox", { name: "版本" }));
    expect(await screen.findByRole("option", { name: "版本 3 · Fixed clock source" })).toBeVisible();
  });
  it("searches and pages authorized dependency resources without losing the filter", async () => {
    const user = userEvent.setup(); setup({ pagination: true });
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.click(await screen.findByRole("button", { name: "新建源码" }));
    await user.click(await screen.findByText("引用其他共享资源"));
    await user.click(screen.getByRole("button", { name: "选择共享资源" }));
    await screen.findByRole("button", { name: "Resource 20" });
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("button", { name: "Resource 21" })).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索共享资源" }), "missing");
    expect(await screen.findByText("没有匹配的可引用资源。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resource 21" })).not.toBeInTheDocument();
  });
  it("explains that unpublished resources cannot be referenced", async () => {
    const user = userEvent.setup(); setup({ draftOnly: true });
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.click(await screen.findByRole("button", { name: "新建源码" }));
    await user.click(await screen.findByText("引用其他共享资源"));
    await user.click(screen.getByRole("button", { name: "选择共享资源" }));
    expect(await screen.findByText("暂无可引用的已发布资源。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Unpublished" })).not.toBeInTheDocument();
  });
  it("selects an exact published dependency through one searchable picker", async () => {
    const user = userEvent.setup();
    const { fetchImpl } = setup({ dependency: true });
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.click(await screen.findByRole("button", { name: "新建源码" }));
    await user.type(await screen.findByLabelText("资源名称"), "Platform");
    await user.click(screen.getByText("引用其他共享资源"));
    expect(screen.queryByLabelText("引用目录")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择共享资源" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索共享资源" }), "clocks");
    await user.click(await screen.findByRole("button", { name: "Common clocks" }));
    await user.click(await screen.findByRole("combobox", { name: "版本" }));
    await user.click(await screen.findByRole("option", { name: "版本 3 · Fixed clock source" }));
    await user.click(screen.getByText("引用目录（可选）"));
    screen.getByText("引用目录（可选）").focus();
    await user.tab();
    expect(screen.getByLabelText("引用目录")).toHaveFocus();
    expect(screen.getByLabelText("引用目录")).toHaveAccessibleDescription("例如 vendor，源码使用 vendor/clocks.dtsi。");
    await user.type(screen.getByLabelText("引用目录"), "vendor/clocks");
    await user.click(screen.getByRole("button", { name: "添加引用" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    const request = fetchImpl.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(request[1]!.body as string).dependencies).toEqual([{ resourceId: "44444444-4444-4444-8444-444444444444", versionId: "55555555-5555-4555-8555-555555555555", mountPath: "vendor/clocks" }]);
    await user.click(await screen.findByText("引用其他共享资源"));
    expect(await screen.findByText("Common clocks · 版本 3 · vendor/clocks")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看 Common clocks · 版本 3 · vendor/clocks 源码" })).toBeVisible();
    expect(screen.getByRole("button", { name: "移除 Common clocks · 版本 3 · vendor/clocks" })).toBeVisible();
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
    await user.type(screen.getByLabelText("头文件搜索目录"), "include");
    await user.type(screen.getByLabelText("预处理宏"), "ENABLED=1");
    await user.click(screen.getByRole("button", { name: /^保存草稿$/u }));
    await screen.findByText("草稿已保存", { exact: true });
    const post = fetchImpl.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ buildInputs: { includeSearchPaths: ["include"], defines: { ENABLED: "1" } } });
    expect(screen.getByLabelText("预处理宏")).toHaveValue("ENABLED=1");
    await user.clear(screen.getByLabelText("预处理宏"));
    await user.type(screen.getByLabelText("预处理宏"), "ENABLED=0");
    expect(screen.getByRole("button", { name: /^保存草稿$/u })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "返回资源列表" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("reveals fixed dependencies only when requested and retains them in draft saves",async()=>{
    const user=userEvent.setup();const {fetchImpl}=setup({dependency:true});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Complete resource");
    await user.click(screen.getByText("引用其他共享资源"));
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));
    await user.click(await screen.findByRole("button",{name:"Common clocks"}));
    await user.click(await screen.findByRole("combobox",{name:"版本"}));
    await user.click(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"}));
    await user.click(screen.getByText("引用目录（可选）"));
    await user.type(screen.getByLabelText("引用目录"),"vendor/clocks");
    await user.click(screen.getByRole("button",{name:"添加引用"}));
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    const request=fetchImpl.mock.calls.find(([,init])=>init?.method==="POST")!;
    expect(JSON.parse(request[1]!.body as string).dependencies).toEqual([{resourceId:"44444444-4444-4444-8444-444444444444",versionId:"55555555-5555-4555-8555-555555555555",mountPath:"vendor/clocks"}]);
    const summary=(await screen.findByText("引用其他共享资源")).closest("details")!;
    expect(summary).not.toHaveAttribute("open");
    expect(await within(summary.querySelector("summary")!).findByText("Common clocks · 版本 3 · vendor/clocks")).toBeVisible();
    await user.click(screen.getByText("引用其他共享资源"));
    expect(screen.getByRole("link",{name:"查看 Common clocks · 版本 3 · vendor/clocks 源码"})).toHaveAttribute("href",expect.stringContaining("version=55555555-5555-4555-8555-555555555555"));
  });
  it("keeps relative file paths and unsaved editor content while switching source members",async()=>{
    const user=userEvent.setup();
    const {fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=[new File(['/include/ "parts/node.dtsi"\n'],"main.dtsi"),new File(['/ { node {}; };\n'],"node.dtsi"),new File(["#define VALUE 42\n"],"constants.h")];
    files.forEach((file,index)=>{Object.defineProperty(file,"webkitRelativePath",{value:["lib/main.dtsi","lib/parts/node.dtsi","headers/constants.h"][index]});
      Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode([ '/include/ "parts/node.dtsi"\n','/ { node {}; };\n',"#define VALUE 42\n"][index]!).buffer});});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    const first=await screen.findByRole("button",{name:"lib/main.dtsi"});
    const target=screen.getByRole("button",{name:"headers/constants.h"});
    expect(first).toHaveAttribute("aria-current","true");
    expect(first).toHaveAttribute("data-variant","outline");
    expect(target).toHaveAttribute("data-variant","outline");
    target.focus(); await user.keyboard("{Enter}");
    expect(target).toHaveAttribute("aria-current","true");
    expect(first).not.toHaveAttribute("aria-current");
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
    await screen.findByRole("button",{name:"选择文件"});
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
