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

describe("shared DTSI project usage", () => {
  it("opens resource configuration for the selected project and shows existing direct references", async () => {
    const user=userEvent.setup();
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
      references:[{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]}]}],total:1,visibility:"organization"})));
    const apiClient=createApiClient({baseUrl:"",fetchImpl});
    render(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
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
    const apiClient=createApiClient({baseUrl:"",fetchImpl});
    render(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
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
    const apiClient=createApiClient({baseUrl:"",fetchImpl});
    const view=render(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByText("可配置")).toBeVisible();
    expect(within(screen.getByText("无权限").closest("tr")!).queryByRole("button",{name:"配置资源包"})).not.toBeInTheDocument();
    expect(within(screen.getByText("待初始化").closest("tr")!).getByText("请先完成配置初始化")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"配置资源包"}));expect(screen.getByRole("dialog",{name:"配置资源包"})).toBeVisible();
    view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-b" search="?view=projects" onNavigate={()=>{}}/>);
    expect(screen.queryByRole("dialog",{name:"配置资源包"})).not.toBeInTheDocument();
  });
  it("shows fixed references by configuration and preserves the selected view", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("project-usages") ? {
      items: [{ projectId: "p1", projectName: "项目甲", projectCode: "A", configSetId: "c1", configSetName: "default", configurationReady: true, canConfigure: true,
        references: [{resourceId:resourceOne,resourceName:"公共电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:true,requiredBy:[]}] },
        {projectId:"p2",projectName:"项目乙",projectCode:"B",configSetId:null,configSetName:null,configurationReady:false,canConfigure:true,references:[]}],
      total:2,visibility:"organization"
    } : {items:[],total:0}), {headers:{"Content-Type":"application/json"}}));
    const apiClient=createApiClient({baseUrl:"",fetchImpl});
    function Harness() {
      const [search,setSearch]=useState("");
      return <SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search={search} onNavigate={path=>setSearch(new URL(path,"http://localhost").search)} />;
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
    const apiClient=createApiClient({baseUrl:"",fetchImpl});
    const view=render(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    await waitFor(()=>expect(fetchImpl).toHaveBeenCalled());
    view.rerender(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-b" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByText("新组织项目")).toBeVisible();
    await act(async()=>release(new Response(JSON.stringify(row("旧组织项目")))));
    expect(screen.queryByText("旧组织项目")).not.toBeInTheDocument();
    expect(screen.getByText("仅显示当前有权访问的项目配置。")).toBeVisible();
  });

  it("surfaces loading failures rather than claiming no references", async () => {
    const apiClient=createApiClient({baseUrl:"",fetchImpl:vi.fn(async()=>new Response(JSON.stringify({error:{message:"服务不可用"}}),{status:503}))});
    render(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search="?view=projects" onNavigate={()=>{}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("服务不可用");
    expect(screen.queryByText("未引用共享资源包")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"重试"})).toBeVisible();
  });

  it("retains URL filters and reveals indirect references without obscuring direct packages", async () => {
    const user=userEvent.setup();
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>new Response(JSON.stringify(String(url).includes("project-usages")?{
      items:[{projectId:"p1",projectName:"项目甲",projectCode:"A",configSetId:"c1",configSetName:"default",configurationReady:true,canConfigure:true,
        references:[{resourceId:resourceOne,resourceName:"电源",versionId:versionOne,version:1,direct:true,state:"active",upgradeAvailable:false,requiredBy:[]},
          {resourceId:resourceTwo,resourceName:"基础",versionId:versionTwo,version:2,direct:false,state:"retired",upgradeAvailable:false,requiredBy:[{resourceId:resourceOne,resourceName:"电源"}]}]}],total:21,visibility:"organization"
    }:{items:[],total:0})));
    const apiClient=createApiClient({baseUrl:"",fetchImpl});
    render(<SharedDtsiPage apiClient={apiClient} canWrite organizationId="org-a" search="?view=projects&usageQuery=电源&usageStatus=referenced&usagePage=2" onNavigate={()=>{}}/>);
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
