import type { ApiClient } from "./apiClient";
import { z } from "zod";

const intentSchema=z.object({id:z.string(),clientMutationId:z.string(),projectId:z.string(),projectName:z.string(),configSetId:z.string(),configSetName:z.string(),status:z.enum(["pending","applied","stopped"]),result:z.object({requestId:z.string(),fileId:z.string(),fileVersionId:z.string(),configRevisionId:z.string()}).optional()});
const itemSchema=z.object({item:intentSchema}),listSchema=z.object({items:z.array(intentSchema),total:z.number().int().nonnegative()});
export type MemberAdditionIntent=z.infer<typeof intentSchema>;
export function createMemberAdditionIntentClient(client:ApiClient,organizationId:string){
  const query=`?${new URLSearchParams({organizationId})}`;
  const path=(projectId:string,configSetId:string)=>`/api/v1/projects/${encodeURIComponent(projectId)}/config-sets/${encodeURIComponent(configSetId)}/member-addition/intents`;
  return {
    async register(projectId:string,configSetId:string,registrationId:string){
      return itemSchema.parse(await client.post(`${path(projectId,configSetId)}${query}`,{registrationId})).item;
    },
    async list(offset:number){return listSchema.parse(await client.get(`/api/v1/member-addition-intents?${new URLSearchParams({organizationId,limit:"50",offset:String(offset)})}`));},
    async stop(item:MemberAdditionIntent){return itemSchema.parse(await client.post(`${path(item.projectId,item.configSetId)}/${encodeURIComponent(item.id)}/stop${query}`,{})).item;},
    async acknowledge(item:MemberAdditionIntent){return itemSchema.parse(await client.post(`${path(item.projectId,item.configSetId)}/${encodeURIComponent(item.id)}/ack${query}`,{})).item;}
  };
}
