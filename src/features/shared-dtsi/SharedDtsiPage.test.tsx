import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { SharedDtsiPage } from "./SharedDtsiPage";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
function setup(options: { writable?: boolean; existingDraft?: boolean; saveError?: boolean;dependency?:boolean;beforeCreate?:()=>Promise<void>;onDraftGet?:(item:Record<string,unknown>)=>Promise<Record<string,unknown>>; reorderOnSave?:boolean; previewError?: {code:string;message:string;details:Record<string,unknown>}; createError?: {code:string;message:string;details:Record<string,unknown>} } = {}) {
  const resourceId = "33333333-3333-4333-8333-333333333333";
  let item: Record<string, unknown> | null = options.existingDraft ? {id:"11111111-1111-4111-8111-111111111111",resourceId,name:"Existing draft",revision:1,updatedAt:"2026-10-25T00:00:00Z",changeDescription:"Existing change",members:[{id:"22222222-2222-4222-8222-000000000000",sourceName:"existing.dtsi",content:"/ { existing {}; };"}]} : null;
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
    if (method === "POST" && String(_url).endsWith("/publication-preview") && options.previewError)
      return new Response(JSON.stringify({error: options.previewError}),{status:409});
    if (method === "POST" && options.createError) return new Response(JSON.stringify({error:options.createError}),{status:400});
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
    if (method === "GET" && String(_url).includes(resourceId)) {if(item && options.onDraftGet)item=await options.onDraftGet(item);return new Response(JSON.stringify({ item }));}
    return new Response(JSON.stringify({ items: options.dependency?[{resourceId:dependencyId,name:"Common clocks",updatedAt:version.createdAt,sourceName:"clock.dtsi",draftRevision:null,currentVersion:version}]:item ? [{ resourceId,name:item.name,updatedAt:item.updatedAt,sourceName:"common.dtsi",draftRevision:item.revision,currentVersion:null }] : [], total: options.dependency||item ? 1 : 0 }));
  });
  const api = createApiClient({ baseUrl: "", fetchImpl });
  function Harness() {
    const [search, setSearch] = useState(options.existingDraft ? `?resource=${resourceId}` : "");
    return <SharedDtsiPage apiClient={api} canWrite={options.writable ?? true} search={search}
      onNavigate={path => setSearch(new URL(path, "http://localhost").search)} />;
  }
  return { ...render(<Harness />), fetchImpl };
}

describe("shared DTSI draft authoring", () => {
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
    fireEvent.change(screen.getByLabelText("构建宏"),{target:{value:"CONFIG=1"}});
    fireEvent.change(screen.getByLabelText("Include 搜索目录"),{target:{value:"include"}});
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
    expect(screen.getByLabelText("构建宏")).toHaveValue("CONFIG=1");expect(screen.getByLabelText("Include 搜索目录")).toHaveValue("include");
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
    await user.type(await screen.findByLabelText("变更说明"),"保存后验证空态");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));await screen.findByText("草稿已保存");
    const input=await screen.findByLabelText("文件路径");await user.clear(input);await user.type(input,"part.dtsi");
    expect(input).toHaveAttribute("aria-invalid","true");expect(screen.getAllByText("文件路径已存在。")).toHaveLength(2);
    expect(screen.getByRole("button",{name:"保存草稿"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"预览发布"})).toBeDisabled();
    await user.clear(input);await user.type(input,"renamed.dtsi");
    expect(input).not.toHaveAttribute("aria-invalid","true");expect(screen.getByRole("button",{name:"保存草稿"})).toBeEnabled();
  });
  it("confirms member removal, selects a neighbor, and leaves a real empty state", async () => {
    const user=userEvent.setup();setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByRole("button",{name:"选择文件"});
    const files=["main.dtsi","part.dtsi"].map(name=>{const file=new File([name],name);Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode(name).buffer});return file;});
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!,files);
    await user.type(await screen.findByLabelText("变更说明"),"保存后验证空态");
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
    expect(screen.getByRole("button",{name:"预览发布"})).toBeDisabled();
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
    await user.type(screen.getByLabelText("变更说明"),"Keep description");
    await user.click(screen.getByText("固定资源依赖（按需）"));
    await user.click(await screen.findByRole("combobox",{name:"依赖资源"}));await user.click(await screen.findByRole("option",{name:"Common clocks"}));
    await user.click(await screen.findByRole("combobox",{name:"依赖固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 3 · Fixed clock source"}));
    await user.click(screen.getByRole("button",{name:"添加固定依赖"}));
    const add=document.querySelector<HTMLInputElement>('input[aria-label="添加源码文件"]')!;
    await user.upload(add,make("/ { replacement {}; };"));
    let dialog=await screen.findByRole("dialog",{name:"替换重名文件？"});
    expect(dialog).toHaveTextContent("main.dtsi");
    await user.click(within(dialog).getByRole("button",{name:"取消"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("original");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("unsaved");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Keep name");expect(screen.getByLabelText("变更说明")).toHaveValue("Keep description");
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
    await user.type(screen.getByLabelText("变更说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"预览发布"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("预处理正忙");
    expect(screen.queryByRole("button",{name:"重新载入"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"重试检查"})).toBeEnabled();
    expect(screen.getByLabelText("变更说明")).toHaveValue("首次发布");
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
    await user.type(screen.getByLabelText("变更说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"预览发布"}));
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
    expect(screen.getByLabelText("变更说明")).toHaveValue("首次发布");
  });
  it("links a verified dependency diagnostic to the exact published member and line", async () => {
    const user=userEvent.setup();
    const resourceId="44444444-4444-4444-8444-444444444444",versionId="55555555-5555-4555-8555-555555555555",memberId="66666666-6666-4666-8666-666666666666";
    const sourceName=`vendor/${"a".repeat(130)}.h`;
    setup({previewError:{code:"VALIDATION_FAILED",message:`${sourceName}:2:1：预处理错误。`,details:{diagnostics:[{sourceName,line:2,column:1,message:"预处理错误。",source:{resourceId,versionId,memberId}}]}}});
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.click(await screen.findByRole("button",{name:"新建源码"}));
    await user.type(await screen.findByLabelText("资源名称"),"Resource");
    await user.type(screen.getByLabelText("变更说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"预览发布"}));
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
    await user.type(screen.getByLabelText("变更说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"预览发布"}));
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
    await user.type(screen.getByLabelText("变更说明"),"首次发布");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    await screen.findByText("草稿已保存");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    await user.type(screen.getByLabelText("变更说明")," 更新");
    await user.click(screen.getByRole("button",{name:"预览发布"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("预处理正忙");
    expect(screen.getByLabelText("文件路径")).toHaveValue("part.dtsi");
    expect(screen.getByLabelText("变更说明")).toHaveValue("首次发布 更新");
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
    await user.type(screen.getByLabelText("变更说明"),"edited");
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
    await user.type(screen.getByLabelText("构建宏"),"INVALID");
    await user.click(screen.getByRole("button",{name:"保存草稿"}));
    const field=screen.getByLabelText("构建宏");
    expect(field).toHaveAttribute("aria-invalid","true");
    expect(field).toHaveAccessibleDescription("构建宏每行填写 NAME=value。");
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
    await user.type(screen.getByLabelText("变更说明"),"Local description");
    await user.type(screen.getByLabelText("资源名称"), " changed");
    const event = new Event("beforeunload", { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "返回资源列表" }));
    await screen.findByRole("dialog", { name: "放弃未保存的更改？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByLabelText("变更说明")).toHaveValue("Local description");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    await user.click(screen.getByRole("button",{name:"main.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-main");
    await user.click(screen.getByRole("button",{name:"part.dtsi"}));
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("local-part");
    expect(screen.getByLabelText("变更说明")).toHaveValue("Local description");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeVisible();
    expect(screen.getByRole("button", { name: "丢弃草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    await screen.findByRole("dialog", { name: "重新载入草稿？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByLabelText("变更说明")).toHaveValue("Local description");
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
    expect(screen.getByLabelText("变更说明")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("DTSI 源码")).toHaveAttribute("aria-readonly","true");
    expect(screen.getByLabelText("DTSI 源码")).toHaveTextContent("existing");
    expect(screen.queryByRole("button",{name:"保存草稿"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"预览发布"})).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.every(([,init])=>!init?.method || init.method === "GET")).toBe(true);
  });

  it("keeps local edits when preview receives a stale draft conflict", async () => {
    const user=userEvent.setup();
    setup({existingDraft:true,previewError:{code:"CONFLICT",message:"草稿已被更新，请重新载入后核对。",details:{}}});
    await user.type(await screen.findByLabelText("资源名称")," local");
    await user.type(screen.getByLabelText("变更说明")," local");
    await user.click(screen.getByRole("button",{name:"预览发布"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已被更新");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Existing draft local");
    expect(screen.getByLabelText("变更说明")).toHaveValue("Existing change local");
    expect(screen.getByRole("button",{name:"重新载入"})).toBeVisible();
    expect(screen.getByRole("button",{name:"丢弃草稿"})).toBeDisabled();
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
    await user.click(await screen.findByRole("button",{name:"预览发布"}));
    expect(screen.getByText("本组织有查看权限的用户可读取完整源码；发布不会自动更新项目配置。")).toBeVisible();
    expect(screen.getByText("预览检查源码与依赖，不代表完整项目编译或设备验证通过。")).toBeVisible();
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
