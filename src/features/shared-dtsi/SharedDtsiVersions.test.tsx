import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { SharedDtsiPage } from "./SharedDtsiPage";
import { SharedDtsiComparison } from "./SharedDtsiComparison";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";

const resourceId="33333333-3333-4333-8333-333333333333";
const versions=[1,2,3].map(version=>({id:`${version}1111111-1111-4111-8111-111111111111`,resourceId,version,name:"Shared source",changeDescription:`Change ${version}`,
  createdAt:"2026-10-25T00:00:00Z",createdByUserId:"author",createdByName:"Source author",digest:`sha256:${version}`}));
const memberId="22222222-2222-4222-8222-222222222222";
const comparison={before:versions[0],after:versions[2],buildInputs:{before:{includeSearchPaths:[],defines:{ROOT_FLAG:"1"}},after:{includeSearchPaths:[],defines:{ROOT_FLAG:"2"}}},dependencies:{before:[],after:[]},sources:[{resourceId,resourceName:"Shared source",memberId,
  before:{sourceName:"lib/node.dtsi",content:'/ { a { value = <1>; }; };'},after:{sourceName:"lib/node.dtsi",content:'/ { a { value = <3>; }; };'}}],
  semantic:{scope:"ordered-fragment-declarations",before:"a { value = <1>; };",after:"a { /delete-property/ value; value = <3>; };",externalReferences:[]}};

describe("immutable version comparison and authorized usage",()=>{
  it("explains macro-only changes while keeping identical original files separate from semantic values",async()=>{
    const user=userEvent.setup();
    const api=createApiClient({baseUrl:"",fetchImpl:async()=>new Response(JSON.stringify({item:{...comparison,sources:[],
      semantic:{...comparison.semantic,before:"/ { context { flag = <1>; }; };",after:"/ { context { flag = <2>; }; };"}}}))});
    render(<SharedDtsiComparison client={createSharedDtsiClient(api)} resourceId={resourceId} before={versions[0]!.id} after={versions[2]!.id} />);
    await screen.findByText("原始源码没有变化");
    await user.click(screen.getByText("构建设置变化"));expect(screen.getByText("ROOT_FLAG=1")).toBeVisible();expect(screen.getByText("ROOT_FLAG=2")).toBeVisible();
    await user.click(screen.getByRole("radio",{name:"语义声明"}));
    expect(screen.getByRole("region",{name:"有序语义声明修改片段"})).toHaveTextContent("flag = <1>");
    expect(screen.getByRole("region",{name:"有序语义声明修改片段"})).toHaveTextContent("flag = <2>");
    expect(screen.getByText(/项目最终效果与兼容性尚未评估/)).toBeVisible();
  });
  it("compares two explicitly chosen versions, retries failure and follows precise authorized configuration and old pins",async()=>{
    const user=userEvent.setup(),navigate=vi.fn();let failed=true;
    const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
      const path=new URL(String(url),"http://localhost").pathname;
      if(path.endsWith("/detail"))return new Response(JSON.stringify({item:{resourceId,name:"Shared source",updatedAt:versions[2]!.createdAt,currentVersion:versions[2],draftRevision:null}}));
      if(path.endsWith("/versions"))return new Response(JSON.stringify({items:[...versions].reverse(),total:3}));
      if(path.endsWith("/comparison"))return failed?(failed=false,new Response(JSON.stringify({error:{code:"INTERNAL_ERROR",message:"Comparison temporarily unavailable"}}),{status:500})):new Response(JSON.stringify({item:comparison}));
      if(path.endsWith("/usages"))return new Response(JSON.stringify({items:[{projectId:"visible/project",projectName:"Visible project",configSetId:"exact-config",configSetName:"Pinned config",versionId:versions[0]!.id,version:1,direct:false,upgradeAvailable:true,evaluation:"not-evaluated"}],total:1,visibility:"authorized-projects"}));
      return new Response(JSON.stringify({item:{...versions[0],members:[{id:memberId,sourceName:"lib/node.dtsi",content:"/ {};",checksum:"sha256:source",sizeBytes:5}],manifest:{schemaVersion:"shared-dtsi/v1",members:[{id:memberId,sourceName:"lib/node.dtsi",checksum:"sha256:source",sizeBytes:5,role:"include"}],externalReferences:[]}}}));
    });
    const api=createApiClient({baseUrl:"",fetchImpl});
    function Harness(){const[search,setSearch]=useState(`?resource=${resourceId}&tab=versions&member=${memberId}&line=8`);return <SharedDtsiPage apiClient={api} organizationId="org" canWrite={false} search={search}
      onNavigate={path=>{navigate(path);if(path.startsWith("/parameter-admin/sources"))setSearch(new URL(path,"http://localhost").search);}} />;}
    render(<Harness/>);
    await screen.findByRole("checkbox",{name:"选择版本 v1"});
    expect(screen.getAllByText("Source author")).toHaveLength(3);
    expect(screen.getByRole("button",{name:"比较所选版本"})).toBeDisabled();
    await user.click(screen.getByRole("checkbox",{name:"选择版本 v3"}));await user.click(screen.getByRole("checkbox",{name:"选择版本 v1"}));
    expect(screen.getByRole("checkbox",{name:"选择版本 v2"})).toBeDisabled();
    await user.click(screen.getByRole("button",{name:"比较所选版本"}));
    await screen.findByText("无法比较所选版本。");await user.click(screen.getByRole("button",{name:"重试"}));
    await screen.findByRole("region",{name:"共享原始源码修改片段"});
    await user.click(screen.getByText("构建设置变化"));expect(screen.getByText("ROOT_FLAG=1")).toBeVisible();expect(screen.getByText("ROOT_FLAG=2")).toBeVisible();
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).includes("/comparison")).every(([url])=>String(url).includes(`before=${versions[0]!.id}&after=${versions[2]!.id}`))).toBe(true);
    await user.click(screen.getByRole("radio",{name:"语义声明"}));
    expect(screen.getByRole("region",{name:"有序语义声明修改片段"})).toHaveTextContent("/delete-property/ value;");
    await user.click(screen.getByRole("tab",{name:"使用情况"}));
    const config=await screen.findByRole("link",{name:"Visible project / Pinned config"});
    expect(config).toHaveAttribute("href","/parameter-admin/projects/visible%2Fproject/configuration?organization=org&configSet=exact-config&tab=effective");
    expect(screen.getByText("有新版本 · 未评估")).toBeVisible();expect(screen.getByText("传递依赖")).toBeVisible();
    expect(screen.getByText(/仅显示当前有权访问/)).toHaveTextContent("1 个授权使用");
    await user.click(config);expect(navigate).toHaveBeenLastCalledWith(config.getAttribute("href"));
    await user.click(screen.getByRole("button",{name:"v1"}));
    await screen.findByText("v1 · 历史版本，只读");
    const target=new URL(navigate.mock.calls.at(-1)![0],"http://localhost");
    expect(target.searchParams.get("version")).toBe(versions[0]!.id);expect(target.searchParams.has("line")).toBe(false);expect(target.searchParams.has("member")).toBe(false);
    expect(screen.queryByRole("button",{name:"创建新版本"})).not.toBeInTheDocument();
  });

  it("drops a comparison completing after the resource context changes",async()=>{
    let finish!:(value:Response)=>void;const user=userEvent.setup();
    const api=createApiClient({baseUrl:"",fetchImpl:async(url)=>{
      const path=new URL(String(url),"http://localhost").pathname;
      if(path.endsWith("/detail"))return new Response(JSON.stringify({item:{resourceId,name:"Shared source",updatedAt:versions[2]!.createdAt,currentVersion:versions[2],draftRevision:null}}));
      if(path.endsWith("/comparison"))return new Promise<Response>(resolve=>{finish=resolve;});
      if(path.endsWith("/usages"))return new Response(JSON.stringify({items:[],total:0,visibility:"authorized-projects"}));
      return new Response(JSON.stringify({items:versions,total:3}));
    }});
    function Harness(){const[search,setSearch]=useState(`?resource=${resourceId}&tab=versions`);return <SharedDtsiPage apiClient={api} canWrite={false} search={search} onNavigate={path=>setSearch(new URL(path,"http://localhost").search)} />;}
    render(<Harness/>);await user.click(await screen.findByRole("checkbox",{name:"选择版本 v1"}));await user.click(screen.getByRole("checkbox",{name:"选择版本 v3"}));
    await user.click(screen.getByRole("button",{name:"比较所选版本"}));await screen.findByLabelText("正在比较所选版本");
    await user.click(screen.getByRole("tab",{name:"使用情况"}));await screen.findByText("没有可显示的项目使用");
    await act(async()=>{finish(new Response(JSON.stringify({item:comparison})));});
    expect(screen.queryByRole("region",{name:"共享原始源码修改片段"})).not.toBeInTheDocument();
  });
});
