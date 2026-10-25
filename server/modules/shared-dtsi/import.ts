import { ApiError } from "../../shared/http/errors";
import { analysisCaseArchiveLimits, AnalysisCaseArchiveError, readBoundedZipArchive } from "../logs/analysisCaseArchive";
import { sharedDtsiDraftInputSchema, sharedDtsiImportLimits, type SharedDtsiDraftInput } from "../contracts/dtoSchemas/sharedDtsi";

/** The existing bounded archive reader rejects links/traversal/duplicates before inflation. */
export async function importSharedDtsiInput(input:SharedDtsiDraftInput):Promise<SharedDtsiDraftInput> {
  if (!input.archive) return input;
  if (input.members || input.content || input.sourceName!=="common.dtsi") throw new ApiError("VALIDATION_FAILED","请选择归档或文件集合中的一种导入方式。");
  let files:Map<string,Buffer>;
  try {
    files=await readBoundedZipArchive(Buffer.from(input.archive.contentBase64,"base64"),{...analysisCaseArchiveLimits,
      maxCompressedBytes:sharedDtsiImportLimits.maxArchiveBytes,maxFileBytes:sharedDtsiImportLimits.maxFileBytes,
      maxFiles:sharedDtsiImportLimits.maxFiles,maxUnpackedBytes:sharedDtsiImportLimits.maxTotalBytes});
  } catch(error) {
    if(error instanceof AnalysisCaseArchiveError)throw new ApiError("VALIDATION_FAILED",error.message,{diagnostics:error.problems.map(message=>({sourceName:input.archive!.name,message}))});
    throw error;
  }
  const members=[...files].map(([sourceName,bytes])=>{
    let content:string;
    try {content=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}
    catch {throw new ApiError("VALIDATION_FAILED",`${sourceName}：源码必须采用 UTF-8 编码。`);}
    return {sourceName,content};
  });
  const parsed=sharedDtsiDraftInputSchema.safeParse({...input,archive:undefined,members});
  if(!parsed.success) {
    const issue=parsed.error.issues[0]!,index=issue.path[1];
    throw new ApiError("VALIDATION_FAILED",`${typeof index==="number"?members[index]?.sourceName??"归档":"归档"}：${issue.message}`,{issues:parsed.error.issues});
  }
  return parsed.data;
}
