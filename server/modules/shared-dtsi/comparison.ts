import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import type { SharedDtsiComparison, SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";
import { loadSharedDtsiClosure } from "./dependencies";
import { preparePublishedSharedDtsiSource, getSharedDtsiVersion } from "./publication";
import { compareSharedDtsiSources } from "./comparisonData";
export { sharedDtsiDeclarationSemantics } from "./comparisonData";

export async function compareSharedDtsiVersions(db:Database,auth:AuthContext,resourceId:string,beforeId:string,afterId:string):Promise<SharedDtsiComparison> {
  const before=await getSharedDtsiVersion(db,auth,resourceId,beforeId),after=await getSharedDtsiVersion(db,auth,resourceId,afterId);
  const prepare=async(version:SharedDtsiVersion)=>({...version,
    preprocessing:(await preparePublishedSharedDtsiSource(db,auth,version)).preprocessing,
    closure:await loadSharedDtsiClosure(db,auth,version.manifest.dependencies??[],resourceId)});
  const delta=compareSharedDtsiSources(await prepare(before),await prepare(after));
  const {members:_beforeMembers,manifest:_beforeManifest,...beforeSummary}=before;
  const {members:_afterMembers,manifest:_afterManifest,...afterSummary}=after;
  return {before:beforeSummary,after:afterSummary,...delta};
}
