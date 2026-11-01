import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { SharedDtsiPage } from "./SharedDtsiPage";

const resourceOne = "a0000000-0000-4000-8000-000000000001";
const resourceTwo = "a0000000-0000-4000-8000-000000000002";
const versionOne = "b0000000-0000-4000-8000-000000000001";
const versionTwo = "b0000000-0000-4000-8000-000000000002";
function clientFor(fetchImpl:typeof fetch){return createApiClient({baseUrl:"",fetchImpl:async(input,init)=>{
  const path=String(input);
  if(path.includes("/api/v1/member-addition-intents"))return new Response(JSON.stringify({items:[],total:0}));
  if(path.includes("/member-addition/intents"))return new Response(JSON.stringify({item:{id:"d0000000-0000-4000-8000-000000000001",clientMutationId:"d0000000-0000-4000-8000-000000000002",projectId:"p1",projectName:"项目甲",configSetId:"c1",configSetName:"default",status:path.includes("/ack")?"applied":"pending"}}));
  return fetchImpl(input,init);
}});}

describe("shared DTSI project usage", () => {
  it("preserves the chosen project and source when an addition diagnostic opens project correction",async()=>{
    const user=userEvent.setup(),navigate=vi.fn(),version={id:versionOne,resourceId:resourceOne,version:1,name:"公共电源",changeDescription:"首次",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const fetchImpl=vi.fn(async(input:string|URL|Request)=>{const path=String(input);
      if(path.includes("project-usages"))return new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[]}],total:1,visibility:"organization"}));
      if(path.includes("/member-addition/preview"))return new Response(JSON.stringify({error:{code:"VALIDATION_FAILED",message:"源码有误",details:{diagnostics:[{severity:"error",code:"unresolved",message:"缺少引用",sourceName:"board.dts",line:4,fileId:"file-a"}]}}}),{status:400});
      if(path.includes("/versions"))return new Response(JSON.stringify({items:[version],total:1}));
      return new Response(JSON.stringify({items:[{resourceId:resourceOne,name:"公共电源",sourceName:"power.dtsi",updatedAt:"today",draftRevision:null,currentVersion:version}],total:1}));});
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects&usageQuery=项目甲" onNavigate={navigate}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"添加资源包"}));
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));await user.click(screen.getByRole("option",{name:"公共电源"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(screen.getByRole("option",{name:"版本 1 · 首次"}));
    await user.click(screen.getByRole("button",{name:"预览加入配置"}));await user.click(await screen.findByRole("button",{name:"修正项目源码"}));
    const target=new URL(navigate.mock.calls.at(-1)![0],"http://localhost");expect(target.pathname).toBe("/parameter-admin/projects/p1/configuration");expect(target.searchParams.get("file")).toBe("file-a");expect(target.searchParams.get("line")).toBe("4");
    const back=new URL(target.searchParams.get("returnTo")!,"http://localhost").searchParams;
    expect(back.get("referenceResource")).toBe(resourceOne);expect(back.get("referenceVersion")).toBe(versionOne);expect(back.get("referenceTargetProject")).toBe("p1");expect(back.get("referenceTargetConfig")).toBe("c1");expect(back.get("usageQuery")).toBe("项目甲");
  });
  it("explains the specific unavailable configuration reason and opens its source workbench",async()=>{
    const rows=[{projectId:"missing",projectName:"尚无解析",configurationIssue:"no-resolved-source"},{projectId:"root",projectName:"缺少根文件",configurationIssue:"missing-root"},{projectId:"drift",projectName:"源码已变化",configurationIssue:"source-changed"}].map(row=>({...row,projectCode:"A",configSetId:`${row.projectId}-set`,configSetName:"default",configurationReady:false,canConfigure:true,references:[]}));
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:rows,total:3,visibility:"organization"})));
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    const check=async(name:string,message:string)=>{const row=(await screen.findByText(name)).closest("tr")!;expect(within(row).getByText(message)).toBeVisible();expect(within(row).getByRole("link",{name:"前往配置工作台"})).toHaveAttribute("href",expect.stringContaining("tab=source"));};
    await check("尚无解析","尚无已解析的配置来源");await check("缺少根文件","配置缺少有效的项目根文件");await check("源码已变化","项目源码与已解析配置不一致");
  });
  it("returns to the resource when session storage rejects the focus hint",async()=>{
    const set=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new DOMException("denied","SecurityError");});const navigate=vi.fn();
    try{render(<SharedDtsiPage apiClient={clientFor(async()=>new Response(JSON.stringify({items:[],total:0,visibility:"organization"})))} canWrite currentUserId="user-a" organizationId="org-a" search={`?view=projects&referenceResource=${resourceOne}&referenceVersion=${versionOne}`} onNavigate={navigate}/>);
      await userEvent.setup().click(screen.getByRole("button",{name:"返回资源包"}));expect(navigate).toHaveBeenCalledWith("/parameter-admin/sources");
    }finally{set.mockRestore();}
  });
  it("shows a direct resource once when another direct package also depends on it",async()=>{
    const refs=[{resourceId:resourceOne,resourceName:"底层包",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[{resourceId:resourceTwo,resourceName:"上层包"}]},
      {resourceId:resourceTwo,resourceName:"上层包",versionId:versionTwo,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}];
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:refs}],total:1,visibility:"organization"})));
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    const row=(await screen.findByText("项目甲")).closest("tr")!;
    expect(within(row).getAllByRole("link",{name:"底层包 · v1"})).toHaveLength(1);
    expect(within(row).getByText("同时由 上层包 引入")).toBeVisible();
  });
  it("identifies same, different and indirect references for a fixed source version",async()=>{
    const version={id:versionTwo,resourceId:resourceOne,version:2,name:"公共电源",changeDescription:"新版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const ref=(id:string,direct:boolean)=>({resourceId:resourceOne,resourceName:"公共电源",versionId:id,version:id===versionOne?1:2,direct,state:"active",upgradeAvailable:false,requiredBy:direct?[]:[{resourceId:resourceTwo,resourceName:"上游包"}]});
    const rows=[{projectId:"p1",projectName:"同版本",configSetId:"c1",references:[ref(versionTwo,true)]},{projectId:"p2",projectName:"旧版本",configSetId:"c2",references:[ref(versionOne,true)]},{projectId:"p3",projectName:"间接引用",configSetId:"c3",references:[ref(versionOne,false)]}].map(row=>({...row,projectCode:"A",configSetName:"default",configurationReady:true,canConfigure:true}));
    const fetchImpl=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const path=String(input);
      if(path.includes("/detail"))return new Response(JSON.stringify({item:{resourceId:resourceOne,name:"公共电源",updatedAt:"today",state:"active",lifecycleRevision:1,draftRevision:null,currentVersion:version}}));
      if(path.includes(`/versions/${versionTwo}`))return new Response(JSON.stringify({item:{...version,members:[{id:versionOne,sourceName:"board.dtsi",content:"/ {};",checksum:"fixed",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:versionOne,sourceName:"board.dtsi",checksum:"fixed",sizeBytes:5,role:"include"}],externalReferences:[]}}}));
      if(path.includes("/member-addition/preview"))return new Response(JSON.stringify({item:{proofToken:"a".repeat(64),configSetId:"c2",fileName:"board.dts",format:"dts",members:[],entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],diagnostics:[],impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0,retainedBindings:0,sourceReplacements:0}}}));
      return new Response(JSON.stringify({items:rows,total:3,visibility:"organization"}));});
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search={`?view=projects&referenceResource=${resourceOne}&referenceVersion=${versionTwo}`} onNavigate={()=>{}}/>);
    expect(await screen.findByText("资源包：公共电源 · v2")).toBeVisible();
    expect(within(screen.getByText("同版本").closest("tr")!).getByText("已固定此版本")).toBeVisible();
    expect(within(screen.getByText("旧版本").closest("tr")!).getByRole("button",{name:"切换至 v2"})).toBeVisible();
    expect(screen.getByText("间接引用").closest("tr")).toHaveTextContent("由 上游包 引入");
    expect(within(screen.getByText("间接引用").closest("tr")!).getByRole("link",{name:"上游包"})).toBeVisible();
    await userEvent.setup().click(within(screen.getByText("旧版本").closest("tr")!).getByRole("button",{name:"切换至 v2"}));
    expect(await screen.findByRole("dialog",{name:"切换共享版本"})).toHaveTextContent("公共电源 · v2");
    await userEvent.setup().click(screen.getByRole("button",{name:"预览版本切换"}));
    const preview=fetchImpl.mock.calls.find(([url])=>String(url).includes("/member-addition/preview"));
    expect(JSON.parse(String(preview![1]!.body)).sharedReference).toMatchObject({resourceId:resourceOne,versionId:versionTwo,replaceVersionId:versionOne});
  });
  it("does not let a late source response overwrite a new identity and version",async()=>{
    let release!:(response:Response)=>void;
    const makeVersion=(id:string,number:number)=>({id,resourceId:resourceOne,version:number,name:`来源${number}`,changeDescription:"发布",digest:"fixed",createdAt:"today",createdByUserId:"admin"});
    const item=(id:string,number:number)=>({...makeVersion(id,number),members:[{id:versionOne,sourceName:"board.dtsi",content:"/ {};",checksum:"fixed",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:versionOne,sourceName:"board.dtsi",checksum:"fixed",sizeBytes:5,role:"include"}],externalReferences:[]}});
    const fetchImpl=vi.fn(async(input:string|URL|Request)=>{const path=String(input);
      if(path.includes("/detail"))return new Response(JSON.stringify({item:{resourceId:resourceOne,name:"来源",updatedAt:"today",state:"active",lifecycleRevision:1,draftRevision:null,currentVersion:makeVersion(versionTwo,2)}}));
      if(path.includes(`/versions/${versionOne}`))return new Promise<Response>(resolve=>{release=resolve;});
      if(path.includes(`/versions/${versionTwo}`))return new Response(JSON.stringify({item:item(versionTwo,2)}));
      return new Response(JSON.stringify({items:[],total:0,visibility:"authorized-projects"}));});
    const apiClient=clientFor(fetchImpl),props={apiClient,canWrite:true,organizationId:"org-a",onNavigate:()=>{}};
    const view=render(<SharedDtsiPage {...props} currentUserId="user-a" search={`?view=projects&referenceResource=${resourceOne}&referenceVersion=${versionOne}`}/>);
    await waitFor(()=>expect(release).toBeTypeOf("function"));
    view.rerender(<SharedDtsiPage {...props} currentUserId="user-b" search={`?view=projects&referenceResource=${resourceOne}&referenceVersion=${versionTwo}`}/>);
    expect(await screen.findByText("资源包：来源2 · v2")).toBeVisible();
    await act(async()=>release(new Response(JSON.stringify({item:item(versionOne,1)}))));
    expect(screen.getByText("资源包：来源2 · v2")).toBeVisible();expect(screen.queryByText(/资源包：来源1/)).not.toBeInTheDocument();
  });
  it.each([200,503])("keeps the old user's late apply outcome available only to that user (%s)",async status=>{
    const user=userEvent.setup();let actor="user-a",complete!:(value:Response)=>void,state:"pending"|"applied"|"stopped"="pending";
    const entry=()=>({id:"d0000000-0000-4000-8000-000000000001",clientMutationId:"d0000000-0000-4000-8000-000000000002",projectId:"p1",projectName:"项目甲",configSetId:"c1",configSetName:"default",status:state});
    const row={projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]};
    let registered=false;const fetchImpl=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const path=String(input);
      if(path.includes("member-addition-intents"))return new Response(JSON.stringify({items:actor==="user-a"&&registered?[entry()]:[],total:actor==="user-a"&&registered?1:0}));
      if(path.includes("/member-addition/intents")){if(path.includes("/stop")){state=state==="applied"?"applied":"stopped";return new Response(JSON.stringify({item:entry()}));}if(path.includes("/ack")){registered=false;return new Response(JSON.stringify({item:entry()}));}registered=true;return new Response(JSON.stringify({item:entry()}));}
      if(path.includes("/member-addition/preview"))return new Response(JSON.stringify({item:{proofToken:"a".repeat(64),configSetId:"c1",fileName:"board.dts",format:"dts",members:[],entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],diagnostics:[],impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0,retainedBindings:0,sourceReplacements:0}}}));
      if(path.includes("/member-addition/apply"))return new Promise<Response>(resolve=>{complete=resolve;});
      if(path.includes("project-usages"))return new Response(JSON.stringify({items:[row],total:1,visibility:"organization"}));
      throw new Error(`Unexpected ${path} ${init?.method}`);});
    const apiClient=createApiClient({baseUrl:"",fetchImpl}),props={apiClient,canWrite:true,organizationId:"org-a",search:"?view=projects",onNavigate:()=>{}};
    const view=render(<SharedDtsiPage {...props} currentUserId="user-a"/>);await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"移除引用"}));
    await user.type(screen.getByRole("textbox",{name:"变更说明"}),"原始原因");await user.click(screen.getByRole("button",{name:"预览移除引用"}));await user.click(await screen.findByRole("button",{name:"确认移除引用"}));
    await waitFor(()=>expect(complete).toBeTypeOf("function"));actor="user-b";view.rerender(<SharedDtsiPage {...props} currentUserId="user-b"/>);await screen.findByRole("button",{name:"配置资源包"});
    expect(screen.queryByText("结果尚未确认")).not.toBeInTheDocument();if(status===200)state="applied";
    await act(async()=>complete(new Response(JSON.stringify(status===200?{item:{requestId:"r",fileId:"f",fileVersionId:"v",configRevisionId:"rev"}}:{error:{code:"INTERNAL_ERROR",message:"failure"}}),{status})));
    actor="user-a";view.rerender(<SharedDtsiPage {...props} currentUserId="user-a"/>);await user.click(await screen.findByRole("button",{name:"核对"}));
    if(status===200)expect(await screen.findByText("操作已应用。")).toBeVisible();else {await user.click(screen.getByRole("button",{name:"确认停止"}));expect(await screen.findByText("操作已停止，不会再执行。")).toBeVisible();}
    expect(Object.values(sessionStorage).some(value=>value.includes("原始原因")||value.includes("a".repeat(64)))).toBe(false);
  });
  it("blocks a new configuration when its unconfirmed operation is outside the current filter or page",async()=>{
    const user=userEvent.setup();const intent={id:"d0000000-0000-4000-8000-000000000001",clientMutationId:"d0000000-0000-4000-8000-000000000002",projectId:"p1",projectName:"项目甲",configSetId:"c1",configSetName:"default",status:"pending"};
    const fetchImpl=vi.fn(async(input:string|URL|Request)=>{const path=String(input);
      if(path.includes("member-addition-intents"))return new Response(JSON.stringify(path.includes("projectId=p1")?{items:[intent],total:1}:{items:[],total:0}));
      return new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[]}],total:1,visibility:"organization"}));});
    render(<SharedDtsiPage apiClient={createApiClient({baseUrl:"",fetchImpl})} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects&usageStatus=referenced&usagePage=2" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));
    expect(await screen.findByText("结果尚未确认")).toBeVisible();expect(screen.queryByRole("dialog",{name:"配置资源包"})).not.toBeInTheDocument();
  });
  it("offers version switching and removal once per direct resource, never for an indirect dependency", async () => {
    const user=userEvent.setup();
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
      references:[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:true,requiredBy:[]},
        {resourceId:resourceTwo,resourceName:"公共基础",versionId:versionTwo,version:1,direct:false,state:"active",upgradeAvailable:false,requiredBy:[{resourceId:resourceOne,resourceName:"公共电源"}]}]}],total:1,visibility:"organization"})));
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));
    const dialog=screen.getByRole("dialog",{name:"配置资源包"});
    expect(within(dialog).getAllByRole("button",{name:"切换版本"})).toHaveLength(1);
    expect(within(dialog).getAllByRole("button",{name:"移除引用"})).toHaveLength(1);
    expect(within(dialog).queryByText("公共基础 · v1")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button",{name:"移除引用"}));
    expect(screen.getByRole("dialog",{name:"移除共享引用"})).toHaveTextContent("版本 1");
    expect(screen.getByRole("button",{name:"预览移除引用"})).toBeVisible();
  });

  it("switches and removes the selected direct reference only after explicit confirmation",async()=>{
    const user=userEvent.setup();let pinned:string|null=versionOne;
    const versions=[versionOne,versionTwo].map((id,index)=>({id,resourceId:resourceOne,version:index+1,name:"公共电源",changeDescription:`版本${index+1}`,digest:"fixed",createdAt:"today",createdByUserId:"admin"}));
    const fetchImpl=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
      const path=String(url);let body:unknown;
      if(path.includes("project-usages"))body={items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
        references:pinned?[{resourceId:resourceOne,resourceName:"公共电源",versionId:pinned,version:pinned===versionOne?1:2,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]:[]}],total:1,visibility:"organization"};
      else if(path.includes("/versions"))body={items:versions,total:2};
      else if(path.includes("/member-addition/preview")){
        const request=JSON.parse(String(init?.body));const removal=Boolean(request.removeSharedReference);
        body={item:{proofToken:"a".repeat(64),configSetId:"c1",fileName:"board.dts",format:"dts",members:[],entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],diagnostics:[],
          ...(removal?{sharedRemoval:{resourceId:resourceOne,versionId:versionTwo,version:2,name:"公共电源"}}:{}),
          sharedSwitch:{beforeVersion:removal?2:1,afterVersion:removal?null:2,dependencies:{before:[],after:[]},sources:[],effective:[],build:{mode:"release",passed:true,includeSearchPaths:[],defines:{}}},
          impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0,retainedBindings:0,sourceReplacements:0}}};
      }else if(path.includes("/member-addition/apply")){const request=JSON.parse(String(init?.body));pinned=request.removeSharedReference?null:request.sharedReference.versionId;body={item:{requestId:"r",fileId:"f",fileVersionId:"v",configRevisionId:"rev"}};}
      else throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
    });
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"切换版本"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));expect(screen.getByRole("option",{name:"版本 1 · 版本1"})).toHaveAttribute("aria-disabled","true");
    await user.click(screen.getByRole("option",{name:"版本 2 · 版本2"}));await user.click(screen.getByRole("button",{name:"预览版本切换"}));
    expect(pinned).toBe(versionOne);await user.type(await screen.findByRole("textbox",{name:"变更说明"}),"切换版本");
    await user.click(screen.getByRole("button",{name:"确认切换版本"}));expect(await screen.findByText("公共电源 · v2")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"移除引用"}));
    await user.click(screen.getByRole("button",{name:"预览移除引用"}));await user.click(await screen.findByRole("button",{name:"取消本次预览"}));expect(pinned).toBe(versionTwo);
    await user.click(screen.getByRole("button",{name:"预览移除引用"}));await user.type(await screen.findByRole("textbox",{name:"变更说明"}),"移除引用");
    await user.click(screen.getByRole("button",{name:"确认移除引用"}));expect(await screen.findByText("未引用共享资源包")).toBeVisible();
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes("/member-addition/apply"))).toHaveLength(2);
  });

  it("opens the existing project correction task with the target version and reason preserved",async()=>{
    sessionStorage.clear();const user=userEvent.setup(),navigate=vi.fn();
    const version={id:versionTwo,resourceId:resourceOne,version:2,name:"公共电源",changeDescription:"新版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const path=String(url);let body:unknown,status=200;
      if(path.includes("project-usages"))body={items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
        references:[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:true,requiredBy:[]}]}],total:1,visibility:"organization"};
      else if(path.includes("/versions"))body={items:[version],total:1};
      else if(path.includes("/member-addition/preview")){status=422;body={error:{code:"VALIDATION_FAILED",message:"项目覆盖冲突",details:{switchConflicts:[{message:"请修正节点",sourceName:"board.dts",fileId:"root-file",line:9,node:"/charger",property:"limit"}]}}};}
      else throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(body),{status});
    });
    render(<SharedDtsiPage apiClient={clientFor(fetchImpl)} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects&usageQuery=项目甲" onNavigate={navigate}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"切换版本"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 2 · 新版"}));
    await user.type(screen.getByRole("textbox",{name:"变更说明"}),"保留本地设置");await user.click(screen.getByRole("button",{name:"预览版本切换"}));
    await user.click(await screen.findByRole("button",{name:"修正项目源码"}));
    const target=new URL(navigate.mock.lastCall![0],"http://local");
    expect(target.pathname).toBe("/parameter-admin/projects/p1/configuration");expect(target.searchParams.get("file")).toBe("root-file");
    expect(target.searchParams.get("returnTo")).toBe("/parameter-admin/sources?view=projects&usageQuery=%E9%A1%B9%E7%9B%AE%E7%94%B2");
    expect(JSON.parse(sessionStorage.getItem("wiseeff.shared-switch:user-a:org-a:p1:c1")!)).toMatchObject({reference:{resourceId:resourceOne,versionId:versionOne},draft:{versionId:versionTwo,reason:"保留本地设置"}});
    sessionStorage.clear();
  });
  it("opens resource configuration for the selected project and shows existing direct references", async () => {
    const user=userEvent.setup();
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
      references:[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]}],total:1,visibility:"organization"})));
    const apiClient=clientFor(fetchImpl);
    render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));
    const dialog=screen.getByRole("dialog",{name:"配置资源包"});
    expect(within(dialog).getByText("项目甲 · 默认配置")).toBeVisible();
    expect(within(dialog).getByText("公共电源 · v1")).toBeVisible();
    expect(within(dialog).getByRole("button",{name:"添加资源包"})).toBeVisible();
  });

  it("previews and confirms a fixed reference before refreshing the selected configuration",async()=>{
    const user=userEvent.setup();let applied=false;
    const version={id:versionOne,resourceId:resourceOne,version:1,name:"公共电源",changeDescription:"初版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const fetchImpl=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
      const path=String(url);
      let body:unknown;
      if(path.includes("project-usages")) body={items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
        references:applied?[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]:[]}],total:1,visibility:"organization"};
      else if(path.includes("/member-addition/preview")) body={item:{proofToken:"a".repeat(64),configSetId:"c1",fileName:"power.dtsi",format:"dts",members:[],entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],diagnostics:[],impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0,retainedBindings:0,sourceReplacements:0}}};
      else if(path.includes("/member-addition/apply")){applied=true;body={item:{requestId:"r",fileId:"f",fileVersionId:"v",configRevisionId:"rev"}};}
      else if(path.includes("/versions"))body={items:[version],total:1};
      else body={items:[{resourceId:resourceOne,name:"公共电源",sourceName:"power.dtsi",draftRevision:null,state:"active",lifecycleRevision:1,updatedAt:"today",currentVersion:version}],total:1};
      return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
    });
    const apiClient=clientFor(fetchImpl);
    render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"添加资源包"}));
    expect(screen.getByRole("dialog",{name:"添加资源包"})).toHaveTextContent("项目甲 · 默认配置");
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));await user.click(await screen.findByRole("option",{name:"公共电源"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 1 · 初版"}));
    await user.click(screen.getByRole("button",{name:"预览加入配置"}));
    expect(applied).toBe(false);await user.type(await screen.findByRole("textbox",{name:"加入原因"}),"配置项目");
    await user.click(screen.getByRole("button",{name:"确认加入配置"}));
    expect(await screen.findByText("公共电源 · v1")).toBeVisible();expect(screen.getByText("资源包已加入配置。")).toBeVisible();
    const operation=fetchImpl.mock.calls.find(([url])=>String(url).includes("/member-addition/apply"));
    expect(operation?.[1]?.method).toBe("POST");expect(JSON.parse(String(operation?.[1]?.body))).toMatchObject({sharedReference:{resourceId:resourceOne,versionId:versionOne},reason:"配置项目"});
  });

  it("only offers configuration on authorized ready targets and closes it when organization changes",async()=>{
    const user=userEvent.setup();
    const row=(projectId:string,ready:boolean,allowed:boolean)=>({projectId,projectName:projectId,projectCode:projectId,configSetId:`${projectId}-set`,configSetName:"default",configurationReady:ready,canConfigure:allowed,references:[]});
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[row("可配置",true,true),row("无权限",true,false),row("待初始化",false,true)],total:3,visibility:"authorized-projects"})));
    const apiClient=clientFor(fetchImpl);
    const view=render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByText("可配置")).toBeVisible();
    expect(within(screen.getByText("无权限").closest("tr")!).queryByRole("button",{name:"配置资源包"})).not.toBeInTheDocument();
    expect(within(screen.getByText("待初始化").closest("tr")!).getByText("请先完成配置初始化")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"配置资源包"}));expect(screen.getByRole("dialog",{name:"配置资源包"})).toBeVisible();
    view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-b" search="?view=projects" onNavigate={()=>{}}/>);
    expect(screen.queryByRole("dialog",{name:"配置资源包"})).not.toBeInTheDocument();
  });

  it("closes a pending resource operation when the signed-in user changes",async()=>{
    const user=userEvent.setup();
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
      references:[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]}],total:1,visibility:"organization"})));
    const apiClient=clientFor(fetchImpl),base={apiClient,canWrite:true,organizationId:"org-a",search:"?view=projects",onNavigate:()=>{}};
    const view=render(<SharedDtsiPage {...base} currentUserId="user-a"/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"移除引用"}));
    expect(screen.getByRole("dialog",{name:"移除共享引用"})).toBeVisible();
    view.rerender(<SharedDtsiPage {...base} currentUserId="user-b"/>);
    expect(screen.queryByRole("dialog",{name:"移除共享引用"})).not.toBeInTheDocument();
  });

  it("refreshes the exact target after a concurrent duplicate and disables the newly referenced package",async()=>{
    const user=userEvent.setup();let concurrent=false,failRefresh=true;
    const version={id:versionOne,resourceId:resourceOne,version:1,name:"公共电源",changeDescription:"初版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const row=()=>({projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
      references:concurrent?[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]:[]});
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const path=String(url);let body:unknown,status=200;
      if(path.includes("project-usages")&&path.includes("projectId=")&&failRefresh){status=403;body={error:{code:"FORBIDDEN",message:"权限已撤销"}};}
      else if(path.includes("project-usages"))body={items:[row()],total:1,visibility:"organization"};
      else if(path.includes("/member-addition/preview")){concurrent=true;status=409;body={error:{code:"CONFLICT",message:"此配置已引用该资源"}};}
      else if(path.includes("/versions"))body={items:[version],total:1};
      else body={items:[{resourceId:resourceOne,name:"公共电源",sourceName:"power.dtsi",draftRevision:null,state:"active",lifecycleRevision:1,updatedAt:"today",currentVersion:version}],total:1};
      return new Response(JSON.stringify(body),{status});
    });
    const apiClient=clientFor(fetchImpl);
    render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects&usageStatus=unreferenced" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"添加资源包"}));
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));await user.click(await screen.findByRole("option",{name:"公共电源"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 1 · 初版"}));
    await user.click(screen.getByRole("button",{name:"预览加入配置"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("权限已撤销");
    expect(screen.getByRole("button",{name:"预览加入配置"})).toBeDisabled();
    expect(screen.getByRole("combobox",{name:"固定版本"})).toHaveAttribute("data-value",versionOne);
    failRefresh=false;await user.click(screen.getByRole("button",{name:"重新核对配置"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("配置已更新");
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));
    expect(await screen.findByRole("option",{name:"公共电源 · 已引用"})).toHaveAttribute("aria-disabled","true");
    const target=fetchImpl.mock.calls.map(([url])=>new URL(String(url),"http://localhost")).find(url=>url.searchParams.get("projectId")==="p1");
    expect(target?.searchParams.get("configSetId")).toBe("c1");expect(target?.searchParams.get("status")).toBe("all");
  });

  it("retains the chosen package and source diagnostic when a conflict does not change its references",async()=>{
    const user=userEvent.setup();let failRefresh=true;
    const version={id:versionOne,resourceId:resourceOne,version:1,name:"公共电源",changeDescription:"初版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const row={projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[]};
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const path=String(url);let body:unknown,status=200;
      if(path.includes("project-usages")&&path.includes("projectId=")&&failRefresh){status=503;body={error:{code:"INTERNAL_ERROR",message:"服务暂不可用"}};}
      else if(path.includes("project-usages"))body={items:[row],total:1,visibility:"organization"};
      else if(path.includes("/member-addition/preview")){status=409;body={error:{code:"CONFLICT",message:"目标位置已有文件，请调整挂载目录"}};}
      else if(path.includes("/versions"))body={items:[version],total:1};
      else body={items:[{resourceId:resourceOne,name:"公共电源",sourceName:"power.dtsi",draftRevision:null,state:"active",lifecycleRevision:1,updatedAt:"today",currentVersion:version}],total:1};
      return new Response(JSON.stringify(body),{status});
    });
    const apiClient=clientFor(fetchImpl);
    render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"添加资源包"}));
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));await user.click(await screen.findByRole("option",{name:"公共电源"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 1 · 初版"}));
    await user.click(screen.getByRole("button",{name:"预览加入配置"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("目标位置已有文件，请调整挂载目录");
    expect(screen.getByRole("alert")).toHaveTextContent("服务暂不可用");
    failRefresh=false;await user.click(screen.getByRole("button",{name:"重新核对配置"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"预览加入配置"})).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("目标位置已有文件，请调整挂载目录");
    expect(screen.getByRole("combobox",{name:"共享资源"})).toHaveAttribute("data-value",resourceOne);
    expect(screen.getByRole("combobox",{name:"固定版本"})).toHaveAttribute("data-value",versionOne);
    await user.click(screen.getByRole("button",{name:"关闭"}));await user.click(screen.getByRole("button",{name:"关闭"}));
    expect(await screen.findByRole("button",{name:"配置资源包"})).toBeVisible();
  });

  it.each(["permission", "unready", "missing", "forbidden", "previewForbidden"] as const)("does not offer a stale target after refresh reports %s",async(failure)=>{
    const user=userEvent.setup();let restored=false,hold=false,release!:(value:Response)=>void;
    const pending=new Promise<Response>(resolve=>{release=resolve;});
    const version={id:versionOne,resourceId:resourceOne,version:1,name:"公共电源",changeDescription:"初版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const row={projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[]};
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const path=String(url);let body:unknown,status=200;
      if(path.includes("project-usages")&&path.includes("projectId=")){
        if(hold)return pending;
        if(restored)body={items:[row],total:1,visibility:"organization"};
        else if(failure==="forbidden"||failure==="previewForbidden"){status=403;body={error:{code:"FORBIDDEN",message:"权限已撤销"}};}
        else body={items:failure==="missing"?[]:[{...row,canConfigure:failure!=="permission",configurationReady:failure!=="unready"}],total:failure==="missing"?0:1,visibility:"organization"};
      }else if(path.includes("project-usages"))body={items:[row],total:1,visibility:"organization"};
      else if(path.includes("/member-addition/preview")){status=failure==="previewForbidden"?403:409;body={error:{code:failure==="previewForbidden"?"FORBIDDEN":"CONFLICT",message:"配置已变化"}};}
      else if(path.includes("/versions"))body={items:[version],total:1};
      else body={items:[{resourceId:resourceOne,name:"公共电源",sourceName:"power.dtsi",draftRevision:null,state:"active",lifecycleRevision:1,updatedAt:"today",currentVersion:version}],total:1};
      return new Response(JSON.stringify(body),{status});
    });
    const apiClient=clientFor(fetchImpl);
    const view=render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"添加资源包"}));
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));await user.click(await screen.findByRole("option",{name:"公共电源"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 1 · 初版"}));
    await user.click(screen.getByRole("button",{name:"预览加入配置"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"重新核对配置"})).toBeEnabled());
    expect(screen.getByRole("button",{name:"预览加入配置"})).toBeDisabled();
    await user.click(screen.getByRole("button",{name:"关闭"}));
    expect(screen.queryByRole("dialog",{name:"配置资源包"})).not.toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByRole("button",{name:"配置资源包"})).not.toBeInTheDocument());
    expect(screen.queryByText("资源包已加入配置。")).not.toBeInTheDocument();
    if(failure==="permission"){
      restored=true;hold=true;await user.click(await screen.findByRole("button",{name:"重新核对"}));
      expect(screen.getByRole("button",{name:"正在核对…"})).toBeDisabled();
      view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-b" search="?view=projects" onNavigate={()=>{}}/>);
      await screen.findByRole("button",{name:"配置资源包"});
      view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
      await screen.findByRole("button",{name:"重新核对"});
      await act(async()=>release(new Response(JSON.stringify({items:[row],total:1,visibility:"organization"}))));
      expect(screen.queryByRole("button",{name:"配置资源包"})).not.toBeInTheDocument();
      hold=false;await user.click(screen.getByRole("button",{name:"重新核对"}));
      expect(await screen.findByRole("button",{name:"配置资源包"})).toBeVisible();
    }
  });

  it("recovers a target which disappeared from the authorized list only after a fresh explicit list reload",async()=>{
    const user=userEvent.setup();let visible=true,hold=false;
    let release!:(response:Response)=>void;
    const delayed=new Promise<Response>(resolve=>{release=resolve;});
    const version={id:versionOne,resourceId:resourceOne,version:1,name:"公共电源",changeDescription:"初版",digest:"fixed",createdAt:"today",createdByUserId:"admin"};
    const row={projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[]};
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const path=String(url);let body:unknown,status=200;
      if(path.includes("project-usages")&&path.includes("projectId=")){visible=false;status=403;body={error:{code:"FORBIDDEN",message:"权限已撤销"}};}
      else if(path.includes("project-usages")){
        if(hold&&path.includes("organizationId=org-a"))return delayed;
        body={items:visible?[row]:[],total:visible?1:0,visibility:"authorized-projects"};
      }
      else if(path.includes("/member-addition/preview")){status=409;body={error:{code:"CONFLICT",message:"配置已变化"}};}
      else if(path.includes("/versions"))body={items:[version],total:1};
      else body={items:[{resourceId:resourceOne,name:"公共电源",sourceName:"power.dtsi",draftRevision:null,state:"active",lifecycleRevision:1,updatedAt:"today",currentVersion:version}],total:1};
      return new Response(JSON.stringify(body),{status});
    });
    const apiClient=clientFor(fetchImpl);
    const view=render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"配置资源包"}));await user.click(screen.getByRole("button",{name:"添加资源包"}));
    await user.click(await screen.findByRole("combobox",{name:"共享资源"}));await user.click(await screen.findByRole("option",{name:"公共电源"}));
    await user.click(await screen.findByRole("combobox",{name:"固定版本"}));await user.click(await screen.findByRole("option",{name:"版本 1 · 初版"}));
    await user.click(screen.getByRole("button",{name:"预览加入配置"}));await waitFor(()=>expect(screen.getByRole("button",{name:"重新核对配置"})).toBeEnabled());
    await user.click(screen.getByRole("button",{name:"关闭"}));
    expect(await screen.findByRole("button",{name:"重新加载列表"})).toBeVisible();
    expect(screen.queryByText("项目甲")).not.toBeInTheDocument();
    hold=true;await user.click(screen.getByRole("button",{name:"重新加载列表"}));
    view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-b" search="?view=projects" onNavigate={()=>{}}/>);
    await waitFor(()=>expect(fetchImpl.mock.calls.some(([url])=>String(url).includes("organizationId=org-b"))).toBe(true));
    hold=false;view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByRole("button",{name:"重新加载列表"})).toBeVisible();
    await act(async()=>release(new Response(JSON.stringify({items:[row],total:1,visibility:"authorized-projects"}))));
    expect(screen.queryByText("项目甲")).not.toBeInTheDocument();
    visible=true;await user.click(screen.getByRole("button",{name:"重新加载列表"}));
    expect(await screen.findByRole("button",{name:"配置资源包"})).toBeVisible();
  });
  it("shows fixed references by configuration and preserves the selected view", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("project-usages") ? {
      items: [{ projectId: "p1", projectName: "项目甲", projectCode: "A", configSetId: "c1", configSetName: "default", configurationReady: true, canConfigure: true,
        references: [{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:true,requiredBy:[]}] },
        {projectId:"p2",projectName:"项目乙",projectCode:"B",configSetId:null,configSetName:null,configurationReady:false,canConfigure:true,references:[]}],
      total:2,visibility:"organization"
    } : {items:[],total:0}), {headers:{"Content-Type":"application/json"}}));
    const apiClient=clientFor(fetchImpl);
    function Harness() {
      const [search,setSearch]=useState("");
      return <SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search={search} onNavigate={path=>setSearch(new URL(path,"http://localhost").search)} />;
    }
    render(<Harness />);
    await user.click(await screen.findByRole("radio",{name:"项目使用"}));
    expect(await screen.findByText("项目甲")).toBeVisible();
    const row=screen.getByText("项目甲").closest("tr")!;
    expect(within(row).getByText("公共电源 · v1")).toBeVisible();
    expect(within(row).getByText("有新版本")).toBeVisible();
    expect(within(row).getByRole("link",{name:"公共电源 · v1"})).toHaveAttribute("href",expect.stringContaining(`version=${versionOne}`));
    const target=new URL(within(row).getByRole("link",{name:"查看生效配置"}).getAttribute("href")!,"http://localhost");
    expect(target.pathname).toBe("/parameter-admin/projects/p1/configuration");
    expect(target.searchParams.get("configSet")).toBe("c1");
    expect(target.searchParams.get("returnTo")).toContain("view=projects");
    expect(screen.getByText("暂无配置")).toBeVisible();
    expect(screen.getByRole("radio",{name:"项目使用"})).toBeChecked();
  });

  it("does not show an old organization's late response after the scope changes", async () => {
    let release!:(value:Response)=>void;
    const pending=new Promise<Response>(resolve=>{release=resolve;});
    const row=(name:string)=>({items:[{projectId:name,projectName:name,projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,references:[]}],total:1,visibility:"authorized-projects"});
    const fetchImpl=vi.fn((url:string|URL|Request)=>String(url).includes("organizationId=org-a")?pending:Promise.resolve(new Response(JSON.stringify(row("新组织项目")))));
    const apiClient=clientFor(fetchImpl);
    const view=render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await waitFor(()=>expect(fetchImpl).toHaveBeenCalled());
    view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-b" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByText("新组织项目")).toBeVisible();
    await act(async()=>release(new Response(JSON.stringify(row("旧组织项目")))));
    expect(screen.queryByText("旧组织项目")).not.toBeInTheDocument();
    expect(screen.getByText("仅显示当前有权访问的项目配置。")).toBeVisible();
  });

  it("surfaces loading failures rather than claiming no references", async () => {
    const apiClient=createApiClient({baseUrl:"",fetchImpl:vi.fn(async()=>new Response(JSON.stringify({error:{message:"服务不可用"}}),{status:503}))});
    render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByText("服务不可用")).toBeVisible();expect(await screen.findByText("无法读取待核对操作，请重试。")).toBeVisible();
    expect(screen.queryByText("未引用共享资源包")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button",{name:"重试"})).toHaveLength(2);
  });

  it("retains URL filters and reveals indirect references without obscuring direct packages", async () => {
    const user=userEvent.setup();
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>new Response(JSON.stringify(String(url).includes("project-usages")?{
      items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
        references:[{resourceId:resourceOne,resourceName:"电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]},
          {resourceId:resourceTwo,resourceName:"基础",versionId:versionTwo,version:2,direct:false,state:"retired",upgradeAvailable:false,requiredBy:[{resourceId:resourceOne,resourceName:"电源"}]}]}],total:21,visibility:"organization"
    }:{items:[],total:0})));
    const apiClient=clientFor(fetchImpl);
    render(<SharedDtsiPage apiClient={apiClient} canWrite currentUserId="user-a" organizationId="org-a" search="?view=projects&usageQuery=电源&usageStatus=referenced&usagePage=2" onNavigate={()=>{}}/>);
    expect(await screen.findByText("电源 · v1")).toBeVisible();
    expect(screen.getByRole("searchbox",{name:"搜索项目使用"})).toHaveValue("电源");
    await user.click(screen.getByText("依赖关系（1）"));
    expect(screen.getByText("基础 · v2")).toBeVisible();
    expect(screen.getByText("已停用")).toBeVisible();
    expect(screen.getByText("· 由 电源 引入")).toBeVisible();
    const request=new URL(String(fetchImpl.mock.calls.find(([url])=>String(url).includes("project-usages"))![0]),"http://localhost");
    expect(request.searchParams.get("q")).toBe("电源");
    expect(request.searchParams.get("status")).toBe("referenced");
    expect(request.searchParams.get("offset")).toBe("20");
    expect(screen.getByText("2 / 2")).toBeVisible();
  });
});
