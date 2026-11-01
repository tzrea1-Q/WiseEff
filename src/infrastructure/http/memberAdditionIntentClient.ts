import type { ApiClient } from "./apiClient";
import { memberAdditionIntentResponseSchema, memberAdditionIntentsResponseSchema, type MemberAdditionIntent } from "@wiseeff/dto-schemas";

export type { MemberAdditionIntent };
export function createMemberAdditionIntentClient(client:ApiClient,organizationId:string){
  const query=`?${new URLSearchParams({organizationId})}`;
  const path=(projectId:string,configSetId:string)=>`/api/v1/projects/${encodeURIComponent(projectId)}/config-sets/${encodeURIComponent(configSetId)}/member-addition/intents`;
  return {
    async register(projectId:string,configSetId:string,registrationId:string){
      return memberAdditionIntentResponseSchema.parse(await client.post(`${path(projectId,configSetId)}${query}`,{registrationId})).item;
    },
    async list(offset:number){return memberAdditionIntentsResponseSchema.parse(await client.get(`/api/v1/member-addition-intents?${new URLSearchParams({organizationId,limit:"50",offset:String(offset)})}`));},
    async target(projectId:string,configSetId:string){return memberAdditionIntentsResponseSchema.parse(await client.get(`/api/v1/member-addition-intents?${new URLSearchParams({organizationId,projectId,configSetId,limit:"1",offset:"0"})}`));},
    async stop(item:MemberAdditionIntent){return memberAdditionIntentResponseSchema.parse(await client.post(`${path(item.projectId,item.configSetId)}/${encodeURIComponent(item.id)}/stop${query}`,{})).item;},
    async acknowledge(item:MemberAdditionIntent){return memberAdditionIntentResponseSchema.parse(await client.post(`${path(item.projectId,item.configSetId)}/${encodeURIComponent(item.id)}/ack${query}`,{})).item;}
  };
}
