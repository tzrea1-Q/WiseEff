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
function setup(options: { writable?: boolean; saveError?: boolean } = {}) {
  const resourceId = "33333333-3333-4333-8333-333333333333";
  let item: Record<string, unknown> | null = null;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const input = JSON.parse(init!.body as string);
      item = { id: "11111111-1111-4111-8111-111111111111", resourceId, name: input.name, revision: 1, updatedAt: "2026-10-25T00:00:00Z",
        members: [{ id: "22222222-2222-4222-8222-222222222222", sourceName: input.sourceName, content: input.content }] };
      return new Response(JSON.stringify({ item }), { status: 201 });
    }
    if (method === "PUT" && options.saveError) return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "草稿已被更新，请重新载入后核对；本地修改仍保留。" } }), { status: 409 });
    if (method === "GET" && String(_url).includes(`${resourceId}/detail`)) return new Response(JSON.stringify({item:{resourceId,name:item?.name,
      updatedAt:"2026-10-25T00:00:00Z",draftRevision:item?.revision,currentVersion:null}}));
    if (method === "GET" && String(_url).includes(resourceId)) return new Response(JSON.stringify({ item }));
    return new Response(JSON.stringify({ items: item ? [{ resourceId,name:item.name,updatedAt:item.updatedAt,sourceName:"common.dtsi",draftRevision:item.revision,currentVersion:null }] : [], total: item ? 1 : 0 }));
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
  it("keeps relative file paths and unsaved editor content while switching source members",async()=>{
    const user=userEvent.setup();
    const {fetchImpl}=setup();
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await screen.findByLabelText("资源名称");
    const files=[new File(['/include/ "parts/node.dtsi"\n'],"main.dtsi"),new File(['/ { node {}; };\n'],"node.dtsi"),new File(["#define VALUE 42\n"],"constants.h")];
    files.forEach((file,index)=>{Object.defineProperty(file,"webkitRelativePath",{value:["lib/main.dtsi","lib/parts/node.dtsi","headers/constants.h"][index]});
      Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode([ '/include/ "parts/node.dtsi"\n','/ { node {}; };\n',"#define VALUE 42\n"][index]!).buffer});});
    await user.upload(document.querySelector('input[type="file"]')!,files);
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
    await screen.findByLabelText("资源名称");
    let finish!: (value:ArrayBuffer)=>void;
    const file=new File(["ignored"],"old-source.dtsi",{type:"text/plain"});
    Object.defineProperty(file,"arrayBuffer",{value:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})});
    await user.upload(document.querySelector('input[type="file"]')!,file);
    await user.click(screen.getByRole("button",{name:"返回资源列表"}));
    await user.click(await screen.findByRole("button",{name:"导入资源"}));
    await user.type(await screen.findByLabelText("资源名称"),"New current draft");
    await act(async()=>{finish(new TextEncoder().encode('/ { old { status = "disabled"; }; };').buffer);});
    expect(screen.getByLabelText("资源名称")).toHaveValue("New current draft");
    expect(screen.getByLabelText("文件路径")).toHaveValue("common.dtsi");
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
      else if (method==="POST" && path.endsWith("/publication-preview")) response={item:{id:"55555555-5555-4555-8555-555555555555",resourceId,draftRevision:1,name:summary.name,changeDescription:summary.changeDescription,manifest,digest:summary.digest,createdAt:summary.createdAt,baseVersionId:null}};
      else if (method==="POST" && path.endsWith("/publications")) {published=true;hasDraft=false;response={item:version};}
      else if (method==="POST" && path.endsWith("/draft")) {hasDraft=true;response={item:{id:"66666666-6666-4666-8666-666666666666",resourceId,name:summary.name,revision:1,updatedAt:summary.createdAt,changeDescription:"",members:[{id:member.id,sourceName:member.sourceName,content:member.content}]}};}
      else if (method==="DELETE" && path.endsWith("/draft")) {hasDraft=false;response={ok:true};}
      else response={item:{id:"11111111-1111-4111-8111-111111111111",resourceId,name:summary.name,revision:1,updatedAt:summary.createdAt,changeDescription:published?"":summary.changeDescription,members:[{id:member.id,sourceName:member.sourceName,content:member.content}]}};
      return new Response(JSON.stringify(response),{status:200});
    }});
    function Harness(){const[search,setSearch]=useState(`?resource=${resourceId}`);return <SharedDtsiPage apiClient={api} canWrite search={search} onNavigate={path=>setSearch(new URL(path,"http://localhost").search)}/>;}
    render(<Harness/>);
    await user.click(await screen.findByRole("button",{name:"预览发布"}));
    expect(screen.getByText("发布共享版本，不会自动更新项目配置。")).toBeVisible();
    expect(screen.getByLabelText("待发布 DTSI 源码")).toHaveAttribute("aria-readonly","true");
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
