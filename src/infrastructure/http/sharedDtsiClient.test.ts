import { expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createSharedDtsiClient } from "./sharedDtsiClient";

it("requests member counts but accepts an older server without inventing one", async () => {
  const fetchImpl = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({items:[{
    resourceId:"11111111-1111-4111-8111-111111111111",name:"Legacy",updatedAt:"2026-10-31T00:00:00Z",
    sourceName:"legacy.dtsi",draftRevision:1,currentVersion:null
  }],total:1})));
  const client = createSharedDtsiClient(createApiClient({baseUrl:"",fetchImpl}));
  const result = await client.list({q:"Legacy"});
  expect(new URL(String(fetchImpl.mock.calls[0]![0]),"http://localhost").searchParams.get("includeMemberCount")).toBe("1");
  expect(result.items[0]).not.toHaveProperty("memberCount");
  expect(result.items[0]).not.toHaveProperty("memberCountScope");
});

it("retains the explicitly supplied member-count scope", async () => {
  const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[{resourceId:"11111111-1111-4111-8111-111111111111",name:"Current",updatedAt:"2026-10-31T00:00:00Z",sourceName:"draft.dtsi",memberCount:2,memberCountScope:"draft",draftRevision:1,currentVersion:null}],total:1})));
  const result=await createSharedDtsiClient(createApiClient({baseUrl:"",fetchImpl})).list();
  expect(result.items[0]).toMatchObject({memberCount:2,memberCountScope:"draft"});
});
