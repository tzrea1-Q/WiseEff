import { ApiError } from "../../shared/http/errors";
import { analysisCaseArchiveLimits, AnalysisCaseArchiveError, readBoundedZipArchive } from "../logs/analysisCaseArchive";
import { sharedDtsiDraftInputSchema, sharedDtsiImportLimits, type SharedDtsiDraftInput } from "../contracts/dtoSchemas/sharedDtsi";
import { inputMembers } from "./service";

/** The existing bounded archive reader rejects links/traversal/duplicates before inflation. */
export async function inspectSharedDtsiArchive(input:SharedDtsiDraftInput) {
  if (!input.archive) throw new ApiError("VALIDATION_FAILED", "请选择 ZIP 归档。");
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
  const ignored:string[]=[];
  const members=[...files].filter(([sourceName])=>{
    if (/[:\u0000-\u001f\u007f]/u.test(sourceName) || sourceName.split("/").length>sharedDtsiImportLimits.maxDepth)
      throw new ApiError("VALIDATION_FAILED",`${sourceName}：归档路径不安全或超过 16 层。`);
    if (/\.(dts|dtsi|h|hpp)$/u.test(sourceName)) return true;
    if (/\.zip$/iu.test(sourceName)) throw new ApiError("VALIDATION_FAILED",`${sourceName}：不支持嵌套归档。`);
    ignored.push(sourceName); return false;
  }).map(([sourceName,bytes])=>{
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
  inputMembers(parsed.data);
  return {input:parsed.data,ignored};
}

export async function importSharedDtsiInput(input:SharedDtsiDraftInput):Promise<SharedDtsiDraftInput> {
  return input.archive ? (await inspectSharedDtsiArchive(input)).input : input;
}
