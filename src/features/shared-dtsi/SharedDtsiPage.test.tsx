import { useLayoutEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { SharedDtsiPage } from "./SharedDtsiPage";
import { SharedDtsiDependencies } from "./SharedDtsiDependencies";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
function setup(options: { writable?: boolean; existingDraft?: boolean; saveError?: boolean;dependency?:boolean;beforeCreate?:()=>Promise<void>;beforePreview?:()=>Promise<void>;onOrganizationLayout?:()=>void;onDraftGet?:(item:Record<string,unknown>)=>Promise<Record<string,unknown>>; reorderOnSave?:boolean; previewError?: {code:string;message:string;details:Record<string,unknown>}; createError?: {code:string;message:string;details:Record<string,unknown>};createStatus?:number; draftOnly?:boolean; pagination?:boolean; failSearch?:Promise<void>; failVersions?:boolean; failPinnedVersion?:boolean } = {}) {
  const resourceId = "33333333-3333-4333-8333-333333333333";
  let item: Record<string, unknown> | null = options.existingDraft ? {id:"11111111-1111-4111-8111-111111111111",resourceId,name:"Existing draft",revision:1,updatedAt:"2026-10-25T00:00:00Z",changeDescription:"Existing change",members:[{id:"22222222-2222-4222-8222-000000000000",sourceName:"existing.dtsi",content:"/ { existing {}; };"}]} : null;
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
    if (method === "POST" && String(_url).endsWith("/publication-preview") && options.previewError)
      return new Response(JSON.stringify({error: options.previewError}),{status:409});
    if (method === "POST" && String(_url).endsWith("/publication-preview") && item) {
      if(options.beforePreview)await options.beforePreview();
      const member=(item.members as {id:string;sourceName:string;content:string}[])[0]!;
      const manifest={schemaVersion:"shared-dtsi/v1",members:[{id:member.id,sourceName:member.sourceName,checksum:"sha256:source",sizeBytes:member.content.length,role:"include"}],externalReferences:[]};
      return new Response(JSON.stringify({item:{id:"55555555-5555-4555-8555-555555555555",resourceId,draftRevision:item.revision,name:item.name,changeDescription:item.changeDescription,manifest,digest:"sha256:source",createdAt:"2026-10-25T00:00:00Z",baseVersionId:null,comparison:{before:null,sources:[{resourceId,resourceName:item.name,memberId:member.id,before:null,after:{sourceName:member.sourceName,content:member.content}}],buildInputs:{before:{includeSearchPaths:[],defines:{}},after:{includeSearchPaths:[],defines:{}}},dependencies:{before:[],after:[]},semantic:{scope:"ordered-fragment-declarations",before:"",after:member.content,externalReferences:[]}}}}));
    }
    if (method === "POST" && options.createError) {if(options.beforeCreate)await options.beforeCreate();return new Response(JSON.stringify({error:options.createError}),{status:options.createStatus??400});}
    if (method === "POST") {
      const input = JSON.parse(init!.body as string);
      item = { id: "11111111-1111-4111-8111-111111111111", resourceId, name: input.name, changeDescription:input.changeDescription, revision: 1, updatedAt: "2026-10-25T00:00:00Z",
        ...(input.buildInputs ? { buildInputs: input.buildInputs } : {}),
        dependencies:input.dependencies,members: (input.members??[{sourceName:input.sourceName,content:input.content}]).map((member:{sourceName:string;content:string},index:number)=>({...member,id:`22222222-2222-4222-8222-${String(index+1).padStart(12,"0")}`})).sort((a:{sourceName:string},b:{sourceName:string})=>a.sourceName.localeCompare(b.sourceName)) };
      if(options.beforeCreate)await options.beforeCreate();
      return new Response(JSON.stringify({ item }), { status: 201 });
    }
    if (method === "PUT" && options.saveError) return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "草稿已被更新，请重新载入后核对；本地修改仍保留。" } }), { status: 409 });
    if(method==="PUT" && item){const input=JSON.parse(init!.body as string);const members=input.members.sort((a:{sourceName:string},b:{sourceName:string})=>a.sourceName.localeCompare(b.sourceName));item={...item,name:input.name,changeDescription:input.changeDescription,buildInputs:input.buildInputs,dependencies:input.dependencies,revision:Number(item.revision)+1,members:options.reorderOnSave?members.reverse():members};return new Response(JSON.stringify({item}));}
    if (method === "GET" && String(_url).includes(`${resourceId}/detail`)) return new Response(JSON.stringify({item:{resourceId,name:item?.name,
      updatedAt:"2026-10-25T00:00:00Z",state,lifecycleRevision,draftRevision:item?.revision,currentVersion:null}}));
    if (method === "GET" && new URL(String(_url),"http://localhost").pathname.includes(resourceId)) {if(item && options.onDraftGet)item=await options.onDraftGet(item);return new Response(JSON.stringify({ item }));}
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
    return new Response(JSON.stringify({ items: options.draftOnly ? [{resourceId:dependencyId,name:"Unpublished",updatedAt:version.createdAt,sourceName:"clock.dtsi",draftRevision:1,currentVersion:null}] : options.dependency?[{resourceId:dependencyId,name:"Common clocks",updatedAt:version.createdAt,sourceName:"clock.dtsi",memberCount:1,memberCountScope:"published",draftRevision:null,currentVersion:version}]:item ? [{ resourceId,name:item.name,updatedAt:item.updatedAt,sourceName:"common.dtsi",memberCount:(item.members as unknown[]).length,memberCountScope:"draft",draftRevision:item.revision,currentVersion:null }] : [], total: options.draftOnly||options.dependency||item ? 1 : 0 }));
  });
  const api = createApiClient({ baseUrl: "", fetchImpl });
  let changeWritable:(value:boolean)=>void=()=>{};
  let changeOrganization:(value:string)=>void=()=>{};
  function Harness() {
    const [search, setSearch] = useState(options.existingDraft ? `?resource=${resourceId}` : "");
    const [writable,setWritable]=useState(options.writable ?? true);changeWritable=setWritable;
    const [organization,setOrganization]=useState("org-a");changeOrganization=setOrganization;
    useLayoutEffect(()=>{if(organization==="org-b")options.onOrganizationLayout?.();},[organization]);
    return <SharedDtsiPage apiClient={api} canWrite={writable} organizationId={organization} search={search}
      onNavigate={path => setSearch(new URL(path, "http://localhost").search)} />;
  }
  return { ...render(<Harness />), fetchImpl,changeWritable:(value:boolean)=>changeWritable(value),changeOrganization:(value:string)=>changeOrganization(value) };
}

describe("shared DTSI draft authoring", () => {
  it("opens project selection with the exact published version from a resource row", async () => {
    const resourceId="33333333-3333-4333-8333-333333333333", versionId="44444444-4444-4444-8444-444444444444";
    const version={id:versionId,resourceId,version:2,name:"Published",changeDescription:"Release",digest:"fixed",createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author"};
    const rows=[{resourceId,name:"Published",updatedAt:version.createdAt,sourceName:"board.dtsi",state:"active",lifecycleRevision:1,draftRevision:1,currentVersion:version}];
    const navigate=vi.fn();
    render(<SharedDtsiPage apiClient={createApiClient({baseUrl:"",fetchImpl:async()=>new Response(JSON.stringify({items:rows,total:1}))})} canWrite currentUserId="user" search="" onNavigate={navigate}/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:"引用到项目"}));
    const params=new URL(navigate.mock.calls[0]![0],"http://localhost").searchParams;
    expect(params.get("view")).toBe("projects");expect(params.get("referenceResource")).toBe(resourceId);expect(params.get("referenceVersion")).toBe(versionId);
  });
  it("represents multi-file resources without presenting the first path as the whole resource", async () => {
    const timestamp="2026-10-25T00:00:00Z",resourceId="33333333-3333-4333-8333-333333333333";
    const version={id:"44444444-4444-4444-8444-444444444444",resourceId,version:2,name:"Published",changeDescription:"Published",digest:"sha256:fixed",createdAt:timestamp,createdByUserId:"author"};
    const base={resourceId,name:"Resource",updatedAt:timestamp,state:"active",lifecycleRevision:1,draftRevision:1,currentVersion:null};
    const rows=[{...base,name:"Single",sourceName:"one.dtsi",memberCount:1,memberCountScope:"draft"},
      {...base,resourceId:"55555555-5555-4555-8555-555555555555",name:"Multiple",sourceName:"first.dtsi",memberCount:3,memberCountScope:"published",currentVersion:version},
      {...base,resourceId:"66666666-6666-4666-8666-666666666666",name:"Unknown",sourceName:"unknown.dtsi"},
      {...base,resourceId:"77777777-7777-4777-8777-777777777777",name:"Empty",sourceName:"",memberCount:0,memberCountScope:null},
      {...base,resourceId:"88888888-8888-4888-8888-888888888888",name:"Fallback",sourceName:"draft.dtsi",memberCount:1,memberCountScope:"draft",currentVersion:version},
      {...base,resourceId:"99999999-9999-4999-8999-999999999999",name:"Count without scope",sourceName:"incomplete.dtsi",memberCount:3}];
    const fetchImpl=vi.fn(async(_url:string | URL | Request)=>new Response(JSON.stringify({items:rows,total:rows.length})));
    render(<SharedDtsiPage apiClient={createApiClient({baseUrl:"",fetchImpl})} canWrite search="" onNavigate={()=>{}}/>);
    const row=(name:string)=>screen.getByRole("button",{name}).closest("tr")!;
    await screen.findByRole("button",{name:"Single"});
    expect(within(row("Single")).getByText("草稿 · one.dtsi")).toBeVisible();
    expect(within(row("Multiple")).getByText("已发布 · 3 个文件")).toBeVisible();expect(within(row("Multiple")).queryByText("first.dtsi")).not.toBeInTheDocument();
    expect(within(row("Multiple")).getByText("v2 · 有草稿")).toBeVisible();
    expect(within(row("Fallback")).getByText("草稿 · draft.dtsi")).toBeVisible();
    expect(within(row("Unknown")).getByText("文件信息不可用")).toBeVisible();expect(within(row("Count without scope")).getByText("文件信息不可用")).toBeVisible();expect(within(row("Empty")).getByText("暂无文件")).toBeVisible();
    expect(new URL(String(fetchImpl.mock.calls[0]![0]),"http://localhost").searchParams.get("includeMemberCount")).toBe("1");
  });
  it("saves a new resource and checks the exact reloaded draft before showing preview", async () => {
    const user=userEvent.setup();const {fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"New resource");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"First version");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("heading",{name:"发布预览"})).toBeVisible();
    const calls=fetchImpl.mock.calls;const create=calls.findIndex(([url,init])=>init?.method==="POST" && String(url).endsWith("/shared-dtsi"));
    const read=calls.findIndex(([url,init],index)=>index>create && (!init?.method || init.method==="GET") && String(url).endsWith("/33333333-3333-4333-8333-333333333333"));
    const check=calls.findIndex(([url,init])=>init?.method==="POST" && String(url).endsWith("/33333333-3333-4333-8333-333333333333/publication-preview"));
    expect(create).toBeGreaterThanOrEqual(0);expect(read).toBeGreaterThan(create);expect(check).toBeGreaterThan(read);
    expect(JSON.parse(calls[check]![1]!.body as string)).toEqual({expectedRevision:1});
  });
  it("retains the selected member and editor session when the first saved draft reload fails", async () => {
    let reads=0;const user=userEvent.setup();const {fetchImpl}=setup({onDraftGet:async item=>{if(++reads===1)throw new TypeError("Failed to fetch");return item;}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=["main.dtsi","part.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);await user.click(await screen.findByRole("button",{name:"part.dtsi"}));
    const editor=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    act(()=>editor.dispatch({selection:{anchor:3}}));editor.scrollDOM.scrollTop=31;editor.scrollDOM.scrollLeft=19;
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"First version");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("请求失败");expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("part.dtsi");expect(screen.getByLabelText("版本说明")).toHaveValue("First version");
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    await user.click(screen.getByRole("button",{name:"重新载入"}));await user.click(within(screen.getByRole("dialog",{name:"重新载入草稿？"})).getByRole("button",{name:"重新载入"}));
    expect(await screen.findByLabelText("文件路径")).toHaveValue("part.dtsi");
    const restored=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    expect(restored.state.selection.main.anchor).toBe(3);expect(restored.scrollDOM.scrollTop).toBe(31);expect(restored.scrollDOM.scrollLeft).toBe(19);
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    await user.click(screen.getByRole("button",{name:"检查并预览"}));expect(await screen.findByRole("heading",{name:"发布预览"})).toBeVisible();
  });
  it("does not automatically check a changed draft when retrying a failed first reload", async () => {
    let reads=0;const user=userEvent.setup();const {fetchImpl}=setup({onDraftGet:async item=>{if(++reads===1)throw new TypeError("Failed to fetch");return {...item,revision:2,members:(item.members as {id:string;sourceName:string;content:string}[]).map(member=>({...member,content:"server changed"}))};}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Changed remotely");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"First version");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    await user.click(await screen.findByRole("button",{name:"重新载入"}));await user.click(within(screen.getByRole("dialog",{name:"重新载入草稿？"})).getByRole("button",{name:"重新载入"}));
    expect(await screen.findByText("草稿在保存后已更新，已载入最新版本。")).toBeVisible();
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("server changed");
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
  });
  it.each(["success","failure"])("keeps the selected member when permission changes during the first draft reload (%s)", async mode => {
    let release!:()=>void,reads=0;const gate=new Promise<void>(resolve=>{release=resolve;});
    const user=userEvent.setup();const {fetchImpl,changeWritable}=setup({onDraftGet:async item=>{const read=++reads;await gate;if(mode==="failure" && read<=2)throw new TypeError("Failed to fetch");return item;}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=["main.dtsi","part.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);await user.click(await screen.findByRole("button",{name:"part.dtsi"}));
    const editor=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;act(()=>editor.dispatch({selection:{anchor:3}}));
    await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"First version");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    await waitFor(()=>expect(fetchImpl.mock.calls.some(([url,init])=>(!init?.method || init.method==="GET") && String(url).endsWith("/33333333-3333-4333-8333-333333333333"))).toBe(true));
    act(()=>changeWritable(false));await waitFor(()=>expect(reads).toBe(2));await act(async()=>release());
    expect(await screen.findByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!.state.selection.main.anchor).toBe(3);
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    if(mode==="failure"){
      expect(screen.getByRole("alert")).toHaveTextContent("请求失败");await user.click(screen.getByRole("button",{name:"重新载入"}));
      await user.click(within(screen.getByRole("dialog",{name:"重新载入草稿？"})).getByRole("button",{name:"重新载入"}));
      expect(await screen.findByLabelText("文件路径")).toHaveValue("part.dtsi");
      expect(EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!.state.selection.main.anchor).toBe(3);
      expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    }
  });
  it.each(["revision", "identity"])("does not automatically check when the created draft changes its %s before reload", async mode => {
    const user=userEvent.setup();const {fetchImpl}=setup({onDraftGet:async item=>({...item,...(mode==="revision"?{revision:2}:{id:"77777777-7777-4777-8777-777777777777"})})});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Concurrent resource");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"First version");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByText("草稿在保存后已更新，已载入最新版本。")).toBeVisible();
    expect(screen.queryByRole("heading",{name:"发布预览"})).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    expect(screen.getByLabelText("版本说明")).toHaveValue("First version");
  });
  it("does not continue publication if write permission changes while creating a draft", async () => {
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const user=userEvent.setup();const {fetchImpl,changeWritable}=setup({beforeCreate:()=>gate});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Permission change");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"First version");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(screen.getByRole("button",{name:"正在保存…"})).toBeDisabled();
    act(()=>changeWritable(false));
    expect(screen.queryByRole("heading",{name:"发布预览"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"准备发布"})).not.toBeInTheDocument();
    expect(screen.getByLabelText("资源名称")).toHaveValue("Permission change");
    expect(screen.getByLabelText("DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.getByLabelText("版本说明")).toHaveValue("First version");expect(screen.getByLabelText("版本说明")).toHaveAttribute("readonly");
    expect(screen.getByText("正在保存草稿，请稍候。")).toBeVisible();
    expect(screen.getByRole("button",{name:"返回资源列表"})).toBeDisabled();expect(requestSettingsLeave()).toBe(false);
    act(()=>changeWritable(true));
    expect(screen.getByRole("button",{name:"正在保存…"})).toBeDisabled();
    await act(async()=>release());
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    expect(screen.getByLabelText("版本说明")).toHaveValue("First version");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("heading",{name:"发布预览"})).toBeVisible();
    expect(fetchImpl.mock.calls.filter(([url,init])=>init?.method==="POST" && String(url).endsWith("/shared-dtsi"))).toHaveLength(1);
  });
  it("protects unsaved edits after write permission is removed", async () => {
    const user=userEvent.setup();const {changeWritable}=setup({existingDraft:true});
    await user.type(await screen.findByLabelText("资源名称")," local");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明")," local");
    act(()=>changeWritable(false));expect(screen.getByLabelText("版本说明")).toHaveValue("Existing change local");expect(screen.getByLabelText("版本说明")).toHaveAttribute("readonly");await user.click(screen.getByRole("button",{name:"返回资源列表"}));
    const dialog=await screen.findByRole("dialog",{name:"放弃未保存的更改？"});
    await user.click(within(dialog).getByRole("button",{name:"继续编辑"}));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Existing draft local");
    await user.click(screen.getByRole("button",{name:"返回资源列表"}));
    await user.click(within(await screen.findByRole("dialog",{name:"放弃未保存的更改？"})).getByRole("button",{name:"放弃并离开"}));
    expect(await screen.findByRole("heading",{name:"共享 DTSI"})).toBeVisible();
  });
  it("shows a definite create failure after losing write permission and preserves the input", async () => {
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const user=userEvent.setup();const {changeWritable}=setup({beforeCreate:()=>gate,createError:{code:"FORBIDDEN",message:"不允许创建草稿。",details:{}},createStatus:403});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Retained input");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"Draft details");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    act(()=>changeWritable(false));expect(requestSettingsLeave()).toBe(false);await act(async()=>release());
    expect(await screen.findByRole("alert")).toHaveTextContent("不允许创建草稿");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Retained input");
    act(()=>changeWritable(true));
    expect(screen.getByLabelText("版本说明")).toHaveValue("Draft details");expect(screen.getByRole("button",{name:"检查并预览"})).toBeEnabled();
  });
  it("treats a lost create response as uncertain and preserves its source for review", async () => {
    const user=userEvent.setup();const {fetchImpl}=setup({beforeCreate:async()=>{throw new TypeError("Failed to fetch");}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Network uncertainty");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"Retained description");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存结果未确认");
    expect(screen.getByRole("button",{name:"检查并预览"})).toBeDisabled();expect(screen.getByLabelText("版本说明")).toHaveValue("Retained description");
    expect(screen.getByLabelText("DTSI 源码")).toBeVisible();expect(fetchImpl.mock.calls.filter(([url,init])=>init?.method==="POST" && String(url).endsWith("/shared-dtsi"))).toHaveLength(1);
    await user.click(screen.getByRole("button",{name:"返回资源列表"}));
    let leave=await screen.findByRole("dialog",{name:"放弃未保存的更改？"});
    expect(leave).toHaveTextContent("资源可能已创建");expect(leave).toHaveTextContent("离开后请先核对资源列表");
    await user.click(within(leave).getByRole("button",{name:"继续编辑"}));expect(screen.getByLabelText("版本说明")).toHaveValue("Retained description");
    await user.click(screen.getByRole("button",{name:"返回资源列表"}));leave=await screen.findByRole("dialog",{name:"放弃未保存的更改？"});
    await user.click(within(leave).getByRole("button",{name:"放弃并离开"}));await user.click(await screen.findByRole("button",{name:"导入资源"}));
    expect(await screen.findByRole("button",{name:"选择文件"})).toBeVisible();
  });
  it("does not disclose a late create failure after an organization change", async () => {
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const inLayout=vi.fn(()=>release());
    const user=userEvent.setup();const {changeOrganization}=setup({beforeCreate:()=>gate,onOrganizationLayout:inLayout,createError:{code:"FORBIDDEN",message:"旧组织创建失败。",details:{}},createStatus:403});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Old organization input");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"Old organization description");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    act(()=>changeOrganization("org-b"));expect(inLayout).toHaveBeenCalledOnce();await act(async()=>{await gate;});
    expect(screen.queryByText("旧组织创建失败。")).not.toBeInTheDocument();expect(screen.queryByDisplayValue("Old organization input")).not.toBeInTheDocument();
    act(()=>changeOrganization("org-a"));expect(screen.queryByText("旧组织创建失败。")).not.toBeInTheDocument();
  });
  it.each([{code:"INTERNAL_ERROR",status:500},{code:"UPSTREAM_ERROR",status:502},{code:"VALIDATION_FAILED",status:500}])("keeps input and requires verification before retrying an uncertain $status create", async ({code,status}) => {
    const user=userEvent.setup();const {fetchImpl}=setup({createStatus:status,createError:{code,message:"服务不可用",details:{}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Uncertain resource");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"First version");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存结果未确认");
    expect(screen.getByRole("link",{name:"在新窗口核对资源列表"})).toHaveAttribute("target","_blank");
    expect(screen.getByRole("button",{name:"检查并预览"})).toBeDisabled();
    expect(screen.getByLabelText("资源名称")).toHaveValue("Uncertain resource");expect(screen.getByLabelText("版本说明")).toHaveValue("First version");
    expect(fetchImpl.mock.calls.filter(([url,init])=>init?.method==="POST" && String(url).endsWith("/shared-dtsi"))).toHaveLength(1);
    await user.click(screen.getByRole("button",{name:"已核对，可重试"}));expect(screen.getByRole("button",{name:"检查并预览"})).toBeEnabled();
  });
  it.each([{code:"VALIDATION_FAILED",status:400},{code:"UNAUTHENTICATED",status:401}])("allows a direct retry after a definite $status rejection", async ({code,status}) => {
    const user=userEvent.setup();setup({createStatus:status,createError:{code,message:"文件校验失败。",details:{}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Invalid draft");await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"Draft details");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("文件校验失败。");
    expect(screen.getByRole("button",{name:"检查并预览"})).toBeEnabled();expect(screen.queryByRole("link",{name:"在新窗口核对资源列表"})).not.toBeInTheDocument();
  });
  it("lets the author remove a retired dependency after a rejected first create", async () => {
    const user=userEvent.setup();setup({dependency:true,createStatus:409,createError:{code:"CONFLICT",message:"依赖资源已停用。",details:{reason:"shared-resource-retired"}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Retired dependency");await user.click(screen.getByText("引用其他共享资源"));
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));await user.click(await screen.findByRole("button",{name:"Common clocks"}));
    await user.click(await screen.findByRole("combobox",{name:"版本"}));await user.click(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"}));
    await user.click(screen.getByRole("button",{name:"添加引用"}));await user.click(screen.getByRole("button",{name:"准备发布"}));
    await user.type(screen.getByLabelText("版本说明"),"Retained details");await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("依赖资源已停用");expect(screen.queryByRole("button",{name:"重新载入"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"移除 Common clocks · 版本 3 · 资源根目录"}));expect(screen.getByRole("button",{name:"检查并预览"})).toBeEnabled();
    expect(screen.getByLabelText("版本说明")).toHaveValue("Retained details");
  });
  it("checks the saved revision once and keeps the check visibly pending", async () => {
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const user=userEvent.setup();const {fetchImpl}=setup({existingDraft:true,beforePreview:()=>gate});
    await user.click(await screen.findByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明")," updated");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("button",{name:"正在检查…"})).toBeDisabled();
    expect(screen.getByLabelText("DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(fetchImpl.mock.calls.filter(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toHaveLength(1);
    await act(async()=>release());expect(await screen.findByRole("heading",{name:"发布预览"})).toBeVisible();
    const check=fetchImpl.mock.calls.find(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))!;
    expect(JSON.parse(check[1]!.body as string)).toEqual({expectedRevision:2});
  });
  it("groups resource actions under more and returns focus after cancelling discard", async () => {
    const user=userEvent.setup();setup({existingDraft:true});
    await screen.findByLabelText("资源名称");
    const more=screen.getByRole("button",{name:"资源更多操作"});
    expect(screen.queryByRole("button",{name:"丢弃草稿"})).not.toBeInTheDocument();
    await user.click(more);await user.click(screen.getByRole("menuitem",{name:"丢弃草稿"}));
    const dialog=screen.getByRole("dialog",{name:"丢弃共享 DTSI 草稿？"});await user.click(within(dialog).getByRole("button",{name:"取消"}));
    expect(more).toHaveFocus();
    await user.click(more);expect(screen.getByRole("menuitem",{name:"停用资源"})).toBeVisible();
  });
  it("lets a new resource prepare publication without saving first and requires a version description only there", async () => {
    const user=userEvent.setup();const {fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"New resource");
    expect(screen.queryByLabelText("版本说明")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"准备发布"}));
    expect(screen.getByLabelText("版本说明")).toHaveValue("");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(screen.getByText("请填写版本说明。")).toBeVisible();
    expect(fetchImpl.mock.calls.some(([url,init])=>init?.method==="POST" && String(url).endsWith("/publication-preview"))).toBe(false);
    await user.click(screen.getByRole("button",{name:"返回编辑"}));
    expect(screen.queryByLabelText("版本说明")).not.toBeInTheDocument();
    expect(screen.getByLabelText("资源名称")).toHaveValue("New resource");
    expect(screen.getByRole("button",{name:"保存草稿"})).toBeEnabled();
  });
  it("blocks unsafe relative paths and canonically equivalent duplicate paths",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=["main.dtsi","café.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    const path=await screen.findByLabelText("文件路径");
    for(const invalid of ["../outside.dtsi","/absolute.dtsi","folder//bad.dtsi","folder\\bad.dtsi"]){
      fireEvent.change(path,{target:{value:invalid}});expect(path).toHaveAttribute("aria-invalid","true");
      expect(screen.getByRole("button",{name:"保存草稿"})).toBeDisabled();
    }
    fireEvent.change(path,{target:{value:"cafe\u0301.dtsi"}});
    expect(path).toHaveAttribute("aria-invalid","true");expect(screen.getAllByText("文件路径已存在。")).toHaveLength(2);
    expect(screen.getByRole("button",{name:"保存草稿"})).toBeDisabled();
  });
  it("confirms all same-batch NFC collisions and keeps unrelated members on cancel and replace",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const make=(name:string,content:string)=>{const file=new File([content],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(content).buffer});return file;};
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,[make("café.dtsi","original café"),make("node.dtsi","original node"),make("keep.h","original keep")]);
    await user.clear(await screen.findByLabelText("资源名称"));await user.type(screen.getByLabelText("资源名称"),"保留资源");
    await user.click(screen.getByText("构建设置",{exact:true}));
    fireEvent.change(screen.getByLabelText("预处理宏"),{target:{value:"CONFIG=1"}});
    fireEvent.change(screen.getByLabelText("头文件搜索目录"),{target:{value:"include"}});
    const add=document.querySelector<HTMLInputElement>('input[aria-label="添加源码文件"]')!;
    const batch=()=>[make("cafe\u0301.dtsi","new café"),make("node.dtsi","new node"),make("extra.h","new extra")];
    await user.upload(add,batch());let dialog=await screen.findByRole("dialog",{name:"替换重名文件？"});
    expect(dialog).toHaveTextContent("cafe\u0301.dtsi");expect(dialog).toHaveTextContent("node.dtsi");
    await user.click(within(dialog).getByRole("button",{name:"取消"}));
    expect(screen.queryByRole("button",{name:"extra.h"})).not.toBeInTheDocument();
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original café");
    await user.click(screen.getByRole("button",{name:"node.dtsi"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original node");
    await user.click(screen.getByRole("button",{name:"keep.h"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original keep");
    await user.click(screen.getByRole("button",{name:"café.dtsi"}));
    expect(screen.getByLabelText("资源名称")).toHaveValue("保留资源");
    expect(screen.getByLabelText("预处理宏")).toHaveValue("CONFIG=1");expect(screen.getByLabelText("头文件搜索目录")).toHaveValue("include");
    await user.upload(add,batch());dialog=await screen.findByRole("dialog",{name:"替换重名文件？"});
    await user.click(within(dialog).getByRole("button",{name:"替换重名文件"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("new café");
    await user.click(screen.getByRole("button",{name:"node.dtsi"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("new node");
    await user.click(screen.getByRole("button",{name:"keep.h"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original keep");
    await user.click(screen.getByRole("button",{name:"extra.h"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("new extra");
  });
  it("does not accept edits during first save or its subsequent reload",async()=>{
    let releaseSave!:()=>void,releaseGet!:()=>void;
    const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;}),getGate=new Promise<void>(resolve=>{releaseGet=resolve;});
    const user=userEvent.setup();setup({beforeCreate:()=>saveGate,onDraftGet:async item=>{await getGate;return item;}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const file=new File(["source"],"main.dtsi");Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode("source").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,file);
    const editor=await screen.findByLabelText("DTSI 源码");await user.click(screen.getByRole("button",{name:"保存草稿"}));
    expect(editor).toHaveAttribute("aria-readonly","true");await user.click(editor);await user.keyboard(" discarded");expect(editor).not.toHaveTextContent("discarded");
    await act(async()=>releaseSave());await waitFor(()=>expect(screen.queryByLabelText("DTSI 源码")).not.toBeInTheDocument());
    await act(async()=>releaseGet());expect(await screen.findByLabelText("DTSI 源码")).toHaveTextContent("source");
  });
  it.each(["changed","removed"] as const)("keeps the correct server member when it was %s before the first reload",async(mode)=>{
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const user=userEvent.setup();const {fetchImpl}=setup({onDraftGet:async current=>{
      await gate;
      const old=current.members as {id:string;sourceName:string;content:string}[];
      const remote={id:"44444444-4444-4444-8444-444444444444",sourceName:"0.dtsi",content:"server inserted"};
      return {...current,revision:2,members:[remote,...old.filter(member=>mode!=="removed" || member.sourceName!=="z.dtsi").map(member=>member.sourceName==="z.dtsi"?{...member,content:"server changed"}:member)]};
    }});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=["z.dtsi","a.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    await user.click(await screen.findByRole("button",{name:"保存草稿"}));
    await waitFor(()=>expect(screen.queryByLabelText("DTSI 源码")).not.toBeInTheDocument());
    await act(async()=>release());
    expect(await screen.findByLabelText("文件路径")).toHaveValue(mode==="changed"?"z.dtsi":"0.dtsi");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent(mode==="changed"?"server changed":"server inserted");
    expect(screen.getByText("草稿在保存后已更新，已载入最新版本。")).toBeVisible();
    expect(screen.queryByText("草稿已保存")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"a.dtsi"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("a.dtsi");
    if(mode==="changed"){
      await user.click(screen.getByRole("button",{name:"z.dtsi"}));
      await user.click(screen.getByLabelText("DTSI 源码"));await user.keyboard("{End} local");
      await user.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存");
      const request=fetchImpl.mock.calls.find(([,init])=>init?.method==="PUT")!;
      expect(JSON.parse(request[1]!.body as string).members).toEqual(expect.arrayContaining([
        expect.objectContaining({sourceName:"0.dtsi",content:"server inserted"}),
        expect.objectContaining({sourceName:"a.dtsi",content:"a.dtsi"}),
        expect.objectContaining({sourceName:"z.dtsi",content:"server changed local"})]));
    }
  });
  it("prevents creating a 129th file and explains the limit",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=Array.from({length:128},(_,index)=>{const name=`file-${index}.dtsi`;const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    expect(await screen.findByRole("button",{name:"新建源码"})).toBeDisabled();
    expect(screen.getByText("最多 128 个文件，请先移除文件。")).toBeVisible();
  });
  it("creates an explicitly named source without replacing the current file",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const source=new File(["main"],"main.dtsi");Object.defineProperty(source,"arrayBuffer",{value:async()=>new TextEncoder().encode("main").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,source);
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    const dialog=screen.getByRole("dialog",{name:"新建源码"});await user.type(within(dialog).getByLabelText("文件路径"),"part.dtsi");
    await user.click(within(dialog).getByRole("button",{name:"创建文件"}));
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("DTSI 源码").textContent).toBe("");
    await user.click(screen.getByRole("button",{name:"main.dtsi"}));expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("main");
  });
  it("keeps the active member and editor position when saving a reordered response",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=["z.dtsi","a.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    const initial=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    act(()=>initial.dispatch({selection:{anchor:3}}));initial.scrollDOM.scrollTop=31;initial.scrollDOM.scrollLeft=19;
    await user.click(await screen.findByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存");
    expect(screen.getByLabelText("文件路径")).toHaveValue("z.dtsi");
    const created=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    expect(created.state.selection.main.anchor).toBe(3);expect(created.scrollDOM.scrollTop).toBe(31);expect(created.scrollDOM.scrollLeft).toBe(19);
    await user.click(screen.getByRole("button",{name:"z.dtsi"}));
    const editor=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    act(()=>editor.dispatch({changes:{from:editor.state.doc.length,insert:" edited"},selection:{anchor:2}}));
    editor.scrollDOM.scrollTop=37;editor.scrollDOM.scrollLeft=21;
    await user.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存");
    expect(screen.getByLabelText("文件路径")).toHaveValue("z.dtsi");
    const saved=EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    expect(saved.state.selection.main.anchor).toBe(2);expect(saved.scrollDOM.scrollTop).toBe(37);expect(saved.scrollDOM.scrollLeft).toBe(21);
    expect(screen.getByRole("button",{name:"保存草稿"})).toBeDisabled();
  });
  it("marks an invalid or duplicate member path and blocks saving until corrected",async()=>{
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));await screen.findByRole("button",{name:"选择文件"});
    const files=["main.dtsi","part.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    await user.click(await screen.findByRole("button",{name:"准备发布"}));await user.type(await screen.findByLabelText("版本说明"),"保存后验证空态");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存");
    const input=await screen.findByLabelText("文件路径");await user.clear(input);await user.type(input,"part.dtsi");
    expect(input).toHaveAttribute("aria-invalid","true");expect(screen.getAllByText("文件路径已存在。")).toHaveLength(2);
    expect(screen.getByRole("button",{name:"保存草稿"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"检查并预览"})).toBeDisabled();
    await user.clear(input);await user.type(input,"renamed.dtsi");
    expect(input).not.toHaveAttribute("aria-invalid","true");expect(screen.getByRole("button",{name:"保存草稿"})).toBeEnabled();
  });
  it("confirms member removal, selects a neighbor, and leaves a real empty state", async () => {
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=["main.dtsi","part.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    await user.click(await screen.findByRole("button",{name:"准备发布"}));await user.type(await screen.findByLabelText("版本说明"),"保存后验证空态");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存");
    await user.click(await screen.findByRole("button",{name:"part.dtsi"}));
    await user.click(screen.getByRole("button",{name:"移除当前文件"}));
    let dialog=screen.getByRole("dialog",{name:"移除文件？"});
    await user.click(within(dialog).getByRole("button",{name:"取消"}));
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    await user.click(screen.getByRole("button",{name:"移除当前文件"}));
    dialog=screen.getByRole("dialog",{name:"移除文件？"});await user.click(within(dialog).getByRole("button",{name:"移除文件"}));
    expect(screen.getByLabelText("文件路径")).toHaveValue("main.dtsi");
    await user.click(screen.getByRole("button",{name:"移除当前文件"}));
    dialog=screen.getByRole("dialog",{name:"移除文件？"});await user.click(within(dialog).getByRole("button",{name:"移除文件"}));
    expect(screen.getByText("暂无源码文件，请添加文件或新建源码。" )).toBeVisible();
    expect(screen.queryByLabelText("DTSI 源码")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"保存草稿"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"检查并预览"})).toBeDisabled();
  });
  it("requires confirmation before replacing matching paths during add", async () => {
    const user=userEvent.setup();setup({dependency:true});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const make=(text:string)=>{const file=new File([text],"main.dtsi");Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(text).buffer});return file;};
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,make("/ { original {}; };"));
    await screen.findByLabelText("DTSI 源码");
    await user.click(screen.getByLabelText("DTSI 源码"));await user.keyboard("{End} unsaved");
    await user.clear(screen.getByLabelText("资源名称"));await user.type(screen.getByLabelText("资源名称"),"Keep name");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"Keep description");
    await user.click(screen.getByText("引用其他共享资源"));
    await user.click(screen.getByRole("button",{name:"选择共享资源"}));await user.click(await screen.findByRole("button",{name:"Common clocks"}));
    await user.click(await screen.findByRole("combobox",{name:"版本"}));await user.click(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"}));
    await user.click(screen.getByRole("button",{name:"添加引用"}));
    const add=document.querySelector<HTMLInputElement>('input[aria-label="添加源码文件"]')!;
    await user.upload(add,make("/ { replacement {}; };"));
    let dialog=await screen.findByRole("dialog",{name:"替换重名文件？"});
    expect(dialog).toHaveTextContent("main.dtsi");
    await user.click(within(dialog).getByRole("button",{name:"取消"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("unsaved");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Keep name");expect(screen.getByLabelText("版本说明")).toHaveValue("Keep description");
    expect(screen.getByText("Common clocks · 版本 3 · 资源根目录")).toBeVisible();
    await user.upload(add,make("/ { replacement {}; };"));
    dialog=await screen.findByRole("dialog",{name:"替换重名文件？"});
    await user.click(within(dialog).getByRole("button",{name:"替换重名文件"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("replacement");
  });
  it("adds a file while keeping edited source in the existing member", async () => {
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const source=new File([""],"main.dtsi");
    Object.defineProperty(source,"arrayBuffer",{value:async()=>new TextEncoder().encode("/ { original {}; };\n").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,source);
    const editor=await screen.findByLabelText("DTSI 源码");
    await user.click(editor);await user.keyboard("{End} edited");
    const extra=new File([""],"extra.h");
    Object.defineProperty(extra,"arrayBuffer",{value:async()=>new TextEncoder().encode("#define EXTRA 1\n").buffer});
    await user.upload(document.querySelector<HTMLInputElement>('input[aria-label="添加源码文件"]')!,extra);
    expect(await screen.findByRole("button",{name:"extra.h"})).toBeVisible();
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("edited");
    await user.click(screen.getByRole("button",{name:"extra.h"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("#define EXTRA 1");
    await user.click(screen.getByRole("button",{name:"main.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("edited");
  });
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
  it("allows retry when preprocessing is busy without treating it as a stale draft", async () => {
    const user = userEvent.setup();
    const {fetchImpl}=setup({previewError:{code:"CONFLICT",message:"预处理正忙，请稍后重试。",details:{reason:"preprocess-busy"}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Busy resource");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("预处理正忙");
    expect(screen.queryByRole("button",{name:"重新载入"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"重试检查"})).toBeEnabled();
    expect(screen.getByLabelText("版本说明")).toHaveValue("首次发布");
    await user.click(screen.getByRole("button",{name:"重试检查"}));
    await screen.findByText("预处理正忙，请稍后重试。");
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/publication-preview"))).toHaveLength(2);
  });
  it("opens a source diagnostic at its file while preserving the draft", async () => {
    const user=userEvent.setup();
    const missing="a-very-long-directory-name/".repeat(6)+"missing.dtsi";
    setup({previewError:{code:"VALIDATION_FAILED",message:`part.dtsi:2:1：缺少依赖文件 ${missing}。`,details:{diagnostics:[{sourceName:"part.dtsi",line:2,column:1,message:`缺少依赖文件 ${missing}。`}]}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=[new File(["/ {};"],"main.dtsi"),new File(['/include/ "missing.dtsi"\n'],"part.dtsi")];
    files.forEach((file,index)=>Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(index?'/include/ "missing.dtsi"\n':"/ {};").buffer}));
    await user.upload(document.querySelector('input[type="file"]')!,files);
    await screen.findByRole("button",{name:"part.dtsi"});
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    const alert=await screen.findByRole("alert");
    expect(within(alert).getByText(`缺少依赖文件 ${missing}。`)).toBeVisible();
    expect(screen.getByText("草稿已保存")).toBeVisible();
    const locate=within(alert).getByRole("button",{name:"定位源码：part.dtsi:2:1"});
    expect(locate).toHaveAttribute("data-variant","outline");
    locate.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent('missing.dtsi');
    expect(screen.getByLabelText("DTSI 源码")).toHaveFocus();
    expect(screen.getByLabelText("版本说明")).toHaveValue("首次发布");
  });
  it("links a verified dependency diagnostic to the exact published member and line", async () => {
    const user=userEvent.setup();
    const resourceId="44444444-4444-4444-8444-444444444444",versionId="55555555-5555-4555-8555-555555555555",memberId="66666666-6666-4666-8666-666666666666";
    const sourceName=`vendor/${"a".repeat(130)}.h`;
    setup({previewError:{code:"VALIDATION_FAILED",message:`${sourceName}:2:1：预处理错误。`,details:{diagnostics:[{sourceName,line:2,column:1,message:"预处理错误。",source:{resourceId,versionId,memberId}}]}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Resource");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    const alert=await screen.findByRole("alert");
    expect(within(alert).getByText("预处理错误。")).toBeVisible();
    const link=within(alert).getByRole("link",{name:`查看源码：${sourceName}:2:1（新窗口）`});
    const url=new URL(link.getAttribute("href")!,"http://localhost");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({resource:resourceId,version:versionId,member:memberId,line:"2",column:"1"});
    expect(link).toHaveAttribute("target","_blank");
  });
  it("keeps an unproven external diagnostic as text", async () => {
    const user=userEvent.setup();
    setup({previewError:{code:"VALIDATION_FAILED",message:"vendor/defs.h:2:1：预处理错误。",details:{diagnostics:[{sourceName:"vendor/defs.h",line:2,column:1,message:"预处理错误。"}]}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Resource");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("vendor/defs.h:2:1");
    expect(screen.queryByRole("link",{name:/vendor\/defs\.h/})).not.toBeInTheDocument();
  });
  it("keeps the active member when an automatic save is followed by a failed check", async () => {
    const user=userEvent.setup();
    setup({previewError:{code:"CONFLICT",message:"预处理正忙",details:{reason:"preprocess-busy"}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=[new File(["/ {};"],"main.dtsi"),new File(["/ {};"],"part.dtsi")];
    files.forEach(file=>Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode("/ {};").buffer}));
    await user.upload(document.querySelector('input[type="file"]')!,files);
    await screen.findByRole("button",{name:"part.dtsi"});
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    await user.type(screen.getByLabelText("版本说明")," 更新");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("预处理正忙");
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("版本说明")).toHaveValue("首次发布 更新");
  });
  it("does not write an old editor snapshot into a different file when a save reorders members", async () => {
    const user=userEvent.setup(); setup({reorderOnSave:true});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=[new File(["/ { first {}; };"],"main.dtsi"),new File(["/ { second {}; };"],"part.dtsi")];
    files.forEach((file,index)=>Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(index?"/ { second {}; };":"/ { first {}; };").buffer}));
    await user.upload(document.querySelector('input[type="file"]')!,files);
    await screen.findByRole("button",{name:"part.dtsi"});
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"edited");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("second");
    await user.click(screen.getByRole("button",{name:"main.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("first");
    expect(screen.getByLabelText("DTSI 源码")).not.toHaveTextContent("second");
  });
  it("associates invalid macro syntax with the macro field", async () => {
    const user=userEvent.setup(); setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Resource");
    await user.click(screen.getByText("构建设置"));
    await user.type(screen.getByLabelText("预处理宏"),"INVALID");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    const field=screen.getByLabelText("预处理宏");
    expect(field).toHaveAttribute("aria-invalid","true");
    expect(field).toHaveAccessibleDescription("预处理宏每行填写 NAME=value。");
    expect(field).toHaveValue("INVALID");
  });
  it("identifies and opens the invalid member path returned by the server", async () => {
    const user=userEvent.setup();
    setup({createError:{code:"VALIDATION_FAILED",message:"路径无效",details:{issues:[{path:["members",1,"sourceName"],message:"路径无效"}]}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=[new File(["/ {};"],"main.dtsi"),new File(["/ {};"],"part.dtsi")];
    files.forEach(file=>Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode("/ {};").buffer}));
    await user.upload(document.querySelector('input[type="file"]')!,files);
    await screen.findByRole("button",{name:"part.dtsi"});
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("路径无效");
    const locate=screen.getByRole("button",{name:"定位文件路径：part.dtsi"});
    expect(locate).toHaveAttribute("data-variant","outline");
    await user.click(locate);
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("文件路径")).toHaveFocus();
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
    expect(screen.queryByLabelText("版本说明")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(screen.getByLabelText("版本说明")).toHaveAccessibleDescription("请填写版本说明。");
    await user.type(screen.getByLabelText("版本说明"),"首次发布");
    expect(screen.queryByText("请填写版本说明。")).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button",{name:"资源更多操作"}));await user.click(screen.getByRole("menuitem",{name:"停用资源"}));
    await user.click(within(screen.getByRole("dialog",{name:"停用资源？"})).getByRole("button",{name:"停用资源"}));
    await screen.findByText(/^资源已停用/);expect(screen.getByLabelText("资源名称")).toHaveValue("Recoverable draft");
    expect(screen.queryByRole("button",{name:"准备发布"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"资源更多操作"}));await user.click(screen.getByRole("menuitem",{name:"恢复资源"}));
    await user.click(within(screen.getByRole("dialog",{name:"恢复资源？"})).getByRole("button",{name:"恢复资源"}));
    await screen.findByText("资源已恢复，可再次建立新引用。",{exact:true});
    expect(screen.getByLabelText("资源名称")).toHaveValue("Recoverable draft");expect(screen.getByRole("button",{name:"准备发布"})).toBeVisible();
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
    const files=[new File(["/ { first {}; };"],"main.dtsi"),new File(["/ { second {}; };"],"part.dtsi")];
    files.forEach((file,index)=>Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(index?"/ { second {}; };":"/ { first {}; };").buffer}));
    await user.upload(document.querySelector('input[type="file"]')!,files);
    await user.click(within(await screen.findByRole("dialog",{name:"替换全部源码？"})).getByRole("button",{name:"替换源码"}));
    await screen.findByRole("button",{name:"part.dtsi"});
    await user.click(screen.getByLabelText("DTSI 源码"));await user.keyboard("{End} // local-main");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    await user.click(screen.getByLabelText("DTSI 源码"));await user.keyboard("{End} // local-part");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明"),"Local description");
    await user.type(screen.getByLabelText("资源名称"), " changed");
    const event = new Event("beforeunload", { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "返回资源列表" }));
    await screen.findByRole("dialog", { name: "放弃未保存的更改？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByLabelText("版本说明")).toHaveValue("Local description");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    await user.click(screen.getByRole("button",{name:"main.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-main");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    expect(screen.getByLabelText("版本说明")).toHaveValue("Local description");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeVisible();
    await user.click(screen.getByRole("button",{name:"资源更多操作"}));expect(screen.getByRole("menuitem",{name:"丢弃草稿"})).toHaveAttribute("aria-disabled","true");await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    await screen.findByRole("dialog", { name: "重新载入草稿？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByLabelText("版本说明")).toHaveValue("Local description");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    await user.click(screen.getByRole("button",{name:"main.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-main");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
  });

  it("does not offer draft mutations to a resource reader", async () => {
    setup({ writable: false });
    await screen.findByText("尚无共享 DTSI");
    expect(screen.queryByRole("button", { name: "导入资源" })).not.toBeInTheDocument();
  });

  it("opens an existing draft read-only without sending mutations", async () => {
    const {fetchImpl}=setup({writable:false,existingDraft:true});
    expect(await screen.findByLabelText("资源名称")).toHaveValue("Existing draft");
    expect(screen.getByLabelText("资源名称")).toHaveAttribute("readonly");
    expect(screen.queryByLabelText("版本说明")).not.toBeInTheDocument();
    expect(screen.getByLabelText("DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("existing");
    expect(screen.queryByRole("button",{name:"保存草稿"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"准备发布"})).not.toBeInTheDocument();
    const unload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(false);
    expect(fetchImpl.mock.calls.every(([,init])=>!init?.method || init.method === "GET")).toBe(true);
  });

  it("keeps local edits when preview receives a stale draft conflict", async () => {
    const user=userEvent.setup();
    setup({existingDraft:true,previewError:{code:"CONFLICT",message:"草稿已被更新，请重新载入后核对。",details:{}}});
    await user.type(await screen.findByLabelText("资源名称")," local");
    await user.click(screen.getByRole("button",{name:"准备发布"}));await user.type(screen.getByLabelText("版本说明")," local");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已被更新");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Existing draft local");
    expect(screen.getByLabelText("版本说明")).toHaveValue("Existing change local");
    expect(screen.getByRole("button",{name:"重新载入"})).toBeVisible();
    await user.click(screen.getByRole("button",{name:"资源更多操作"}));expect(screen.getByRole("menuitem",{name:"丢弃草稿"})).toHaveAttribute("aria-disabled","true");
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
    const search=`?${new URLSearchParams({resource:resourceId,version:versionId,member:member.id,line:"1",column:"5",projectContext:context})}`;
    render(<SharedDtsiPage apiClient={api} canWrite organizationId="org" search={search} onNavigate={()=>{}} />);
    await screen.findByText("v1 · 历史版本，只读");
    expect(screen.getByLabelText("已发布 DTSI 源码")).toHaveTextContent("battery");
    expect(screen.getByLabelText("已发布 DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.getByLabelText("已发布 DTSI 源码").querySelector('[data-focused="true"]')).toHaveTextContent("battery");
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
    expect(await screen.findByRole("button",{name:"返回资源列表"})).toHaveAttribute("data-variant","outline");
    await user.click(await screen.findByRole("button",{name:"准备发布"}));await user.click(screen.getByRole("button",{name:"检查并预览"}));
    expect(screen.getByRole("heading",{name:"发布预览"})).toBeVisible();
    expect(screen.getByText("已检查源码及共享资源依赖；未验证项目编译、设备树 Schema 或硬件。")).toBeVisible();
    expect(screen.getByText("本组织有查看权限的用户可读取完整源码；发布不会自动更新项目配置。")).toBeVisible();
    expect(screen.getByLabelText("首次发布 → 待发布版本")).toBeVisible();
    expect(screen.queryByRole("combobox",{name:"比较文件"})).not.toBeInTheDocument();
    expect(screen.getByText("新增 battery.dtsi")).toBeVisible();
    screen.getByRole("button",{name:"返回编辑"}).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button",{name:"检查并预览"})).toHaveFocus();
    expect(screen.getByLabelText("版本说明")).toHaveValue("首次共享版本");
    await user.click(screen.getByRole("button",{name:"检查并预览"}));
    await user.click(screen.getByRole("radio",{name:"语义声明"}));
    expect(within(screen.getByRole("region",{name:"有序语义声明修改片段"})).queryByText("删除行")).not.toBeInTheDocument();
    expect(screen.getByLabelText("有序语义声明变更后")).toHaveTextContent("battery");
    await user.click(screen.getByRole("button",{name:"发布版本"}));
    await screen.findByText("v1 · 已发布，只读");
    expect(screen.getByRole("button",{name:"返回资源列表"})).toHaveAttribute("data-variant","outline");
    expect(screen.getByLabelText("已发布 DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.queryByRole("button",{name:"保存草稿"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab",{name:"版本"}));
    await user.click(await screen.findByRole("button",{name:"v1"}));
    await user.click(await screen.findByRole("button",{name:"创建新版本"}));
    await screen.findByLabelText("资源名称");
    await user.click(screen.getByRole("button",{name:"资源更多操作"}));await user.click(screen.getByRole("menuitem",{name:"丢弃草稿"}));
    const dialog=await screen.findByRole("dialog",{name:"丢弃共享 DTSI 草稿？"});
    expect(dialog).toHaveTextContent("已发布版本和历史会保留");
    await user.click(within(dialog).getByRole("button",{name:"丢弃草稿"}));
    await screen.findByText("v1 · 已发布，只读");
    expect(published).toBe(true);
  });
});
