import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {createApiClient} from "@/infrastructure/http/apiClient";
import {SharedDtsiSubjectCreation} from "./SharedDtsiSubjectCreation";

vi.mock("@/features/parameter-catalog-governance/PublicationDialog",()=>({PublicationDialog:({sourcePrefill}:{sourcePrefill?:{compatible:string;label:string;href:string}})=><div aria-label="既有主体创建"><input aria-label="compatible 标识" defaultValue={sourcePrefill?.compatible}/><a href={sourcePrefill?.href}>{sourcePrefill?.label}</a></div>}));
const resource="11111111-1111-4111-8111-111111111111",version="22222222-2222-4222-8222-222222222222",member="33333333-3333-4333-8333-333333333333";
const data={resourceId:resource,versionId:version,catalogReleaseId:"release",items:[{nodeLocator:"/unit@2",labels:["second"],unresolved:false,candidate:{status:"unknown",subjectIds:[]},source:{resourceId:resource,versionId:version,memberId:member,sourceName:"long/precise.dtsi",version:1,line:17},compatibles:[{compatible:"vendor,actual",status:"unknown",subjectIds:[]}]}]};
it("prefills only a selector re-read from the authorized frozen node, with an exact original source link",async()=>{
  const api=createApiClient({baseUrl:"",fetchImpl:vi.fn(async()=>new Response(JSON.stringify(data)))});
  render(<SharedDtsiSubjectCreation apiClient={api} sourceQuery={`?sourceResource=${resource}&sourceVersion=${version}&sourceNode=%2Funit%402&compatible=vendor%2Cactual`}
    publicationProps={{} as never}/>);
  expect(await screen.findByLabelText("compatible 标识")).toHaveValue("vendor,actual");
  expect(screen.getByRole("link")).toHaveAttribute("href",expect.stringContaining(`member=${member}&line=17`));
});
it("refuses a forged selector even when the resource/version/node are readable",async()=>{
  const api=createApiClient({baseUrl:"",fetchImpl:vi.fn(async()=>new Response(JSON.stringify(data)))});
  render(<SharedDtsiSubjectCreation apiClient={api} sourceQuery={`?sourceResource=${resource}&sourceVersion=${version}&sourceNode=%2Funit%402&compatible=vendor%2Cforged`}
    publicationProps={{} as never}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("来源与 compatible 标识不匹配");
  expect(screen.queryByLabelText("既有主体创建")).not.toBeInTheDocument();
});
