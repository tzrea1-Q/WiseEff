import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { parameterOrganizationId } from "../parameters/operatingScope";
import { sharedDtsiPublicationSource as publicationSource } from "./source";
import type { SharedDtsiDraft, SharedDtsiManifest, SharedDtsiPublicationPreview, SharedDtsiResourceDetail,
  SharedDtsiVersion, SharedDtsiVersionSummary } from "../contracts/dtoSchemas/sharedDtsi";
import { sharedDtsiManifestSchema } from "../contracts/dtoSchemas/sharedDtsi";
import { getSharedDtsiDraft, lockDraft, requireRead, requireWrite, type WriteContext } from "./service";
import { closureManifest, closureMembers, loadSharedDtsiClosure } from "./dependencies";

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const actorFingerprint = (auth: AuthContext) => digest({ userId:auth.user.id,organizationId:parameterOrganizationId(auth),active:auth.user.isActive,
  roles:[...auth.roles].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),permissions:[...auth.permissions].sort() });
const summaryColumns = `id,resource_id as "resourceId",version,name,change_description as "changeDescription",digest,
  created_at as "createdAt",created_by_user_id as "createdByUserId"`;
type VersionRow = Omit<SharedDtsiVersionSummary,"createdAt"> & {createdAt:Date};
const summary = (row: VersionRow): SharedDtsiVersionSummary => ({...row,createdAt:row.createdAt.toISOString()});
const conflict = (message="草稿或共享版本已变化，请重新生成发布预览。") => new ApiError("CONFLICT",message,{reason:"shared-source-preview-stale"});

async function completePublicationSource(db:Database,auth:AuthContext,draft:SharedDtsiDraft) {
  const resources=await loadSharedDtsiClosure(db,auth,draft.dependencies??[],draft.resourceId);
  const members=[...draft.members,...closureMembers(resources)];
  if(members.length>128 || members.reduce((size,member)=>size+Buffer.byteLength(member.content),0)>16_777_216)
    throw new ApiError("VALIDATION_FAILED","完整依赖超过 128 个文件或 16 MiB。");
  const paths=new Set<string>();
  for(const member of members) {
    const path=member.sourceName.normalize("NFC");
    if(paths.has(path))throw new ApiError("VALIDATION_FAILED",`${path}：本资源与依赖的挂载路径冲突。`);
    paths.add(path);
  }
  const source=await publicationSource({...draft,members});
  if(!resources.length && !draft.dependencies?.length)return source;
  const own=new Set(draft.members.map(member=>member.id));
  source.members=source.members.filter(member=>own.has(member.id));
  source.manifest={...source.manifest,members:source.manifest.members.filter(member=>own.has(member.id)),
    dependencies:draft.dependencies??[],dependencyClosure:closureManifest(resources)};
  source.digest=digest({name:draft.name,manifest:source.manifest,changeDescription:draft.changeDescription});
  return source;
}

async function currentVersion(db: Database,auth: AuthContext,resourceId: string) {
  const row=(await db.query<VersionRow>(`select ${summaryColumns} from public.shared_dtsi_revisions
    where resource_id=$1 and organization_id=$2 order by version desc limit 1`,[resourceId,parameterOrganizationId(auth)])).rows[0];
  return row?summary(row):null;
}
export async function getSharedDtsiResourceDetail(db: Database,auth: AuthContext,resourceId: string): Promise<SharedDtsiResourceDetail> {
  requireRead(auth);
  const row=(await db.query<{resourceId:string;name:string;updatedAt:Date;draftRevision:number|null}>(
    `select r.id as "resourceId",r.name,r.updated_at as "updatedAt",d.revision as "draftRevision" from public.shared_dtsi_resources r
     left join public.shared_dtsi_drafts d on d.resource_id=r.id and d.organization_id=r.organization_id
     where r.id=$1 and r.organization_id=$2`,[resourceId,parameterOrganizationId(auth)])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND","共享 DTSI 资源不存在。");
  return {...row,updatedAt:row.updatedAt.toISOString(),currentVersion:await currentVersion(db,auth,resourceId)};
}
export async function listSharedDtsiVersions(db: Database,auth: AuthContext,resourceId: string,input:{offset:number;limit:number}) {
  await getSharedDtsiResourceDetail(db,auth,resourceId);
  const items=(await db.query<VersionRow>(`select ${summaryColumns} from public.shared_dtsi_revisions
    where resource_id=$1 and organization_id=$2 order by version desc limit $3 offset $4`,[resourceId,parameterOrganizationId(auth),input.limit,input.offset])).rows.map(summary);
  const total=(await db.query<{count:string}>("select count(*) from public.shared_dtsi_revisions where resource_id=$1 and organization_id=$2",[resourceId,parameterOrganizationId(auth)])).rows[0]!.count;
  return {items,total:Number(total)};
}
export async function getSharedDtsiVersion(db: Database,auth: AuthContext,resourceId: string,versionId: string): Promise<SharedDtsiVersion> {
  requireRead(auth);
  const row=(await db.query<VersionRow & {manifest:SharedDtsiManifest}>(`select ${summaryColumns},manifest from public.shared_dtsi_revisions
    where id=$1 and resource_id=$2 and organization_id=$3`,[versionId,resourceId,parameterOrganizationId(auth)])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND","共享 DTSI 版本不存在。");
  const members=(await db.query<SharedDtsiVersion["members"][number]>(`select member_id as id,source_name as "sourceName",content,checksum,size_bytes as "sizeBytes"
    from public.shared_dtsi_revision_members where revision_id=$1 and organization_id=$2 order by source_name,member_id`,[versionId,parameterOrganizationId(auth)])).rows;
  return {...summary(row),manifest:sharedDtsiManifestSchema.parse(row.manifest),members};
}

type PreviewRow={id:string;resourceId:string;draftId:string;draftRevision:number;baseVersionId:string|null;actorUserId:string;actorFingerprint:string;
  name:string;changeDescription:string;manifest:SharedDtsiManifest;members:SharedDtsiVersion["members"];digest:string;createdAt:Date;
  idempotencyKey:string|null;publishedRevisionId:string|null};
const previewColumns=`id,resource_id as "resourceId",draft_id as "draftId",draft_revision as "draftRevision",base_revision_id as "baseVersionId",
  actor_user_id as "actorUserId",actor_fingerprint as "actorFingerprint",name,change_description as "changeDescription",manifest,members,digest,
  created_at as "createdAt",idempotency_key as "idempotencyKey",published_revision_id as "publishedRevisionId"`;
const previewDto=(row:PreviewRow):SharedDtsiPublicationPreview=>({id:row.id,resourceId:row.resourceId,draftRevision:row.draftRevision,baseVersionId:row.baseVersionId,
  name:row.name,changeDescription:row.changeDescription,manifest:row.manifest,digest:row.digest,createdAt:row.createdAt.toISOString()});
export async function previewSharedDtsiPublication(db:Database,auth:AuthContext,resourceId:string,expectedRevision:number,context:WriteContext) {
  requireWrite(auth,context);
  return db.transaction(async tx=>{
    await lockDraft(tx,auth,resourceId,expectedRevision);
    const draft=await getSharedDtsiDraft(tx,auth,resourceId),source=await completePublicationSource(tx,auth,draft),base=await currentVersion(tx,auth,resourceId);
    const row=(await tx.query<PreviewRow>(`insert into public.shared_dtsi_publication_previews
      (id,resource_id,organization_id,draft_id,draft_revision,base_revision_id,actor_user_id,actor_fingerprint,name,change_description,manifest,members,digest)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) returning ${previewColumns}`,
      [randomUUID(),resourceId,parameterOrganizationId(auth),draft.id,draft.revision,base?.id??null,auth.user.id,actorFingerprint(auth),draft.name,
        draft.changeDescription,JSON.stringify(source.manifest),JSON.stringify(source.members),source.digest])).rows[0]!;
    return previewDto(row);
  });
}
export async function publishSharedDtsi(db:Database,auth:AuthContext,resourceId:string,input:{previewId:string;idempotencyKey:string},context:WriteContext) {
  const invocation=requireWrite(auth,context),organizationId=parameterOrganizationId(auth);
  return db.transaction(async tx=>{
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`shared-dtsi:${organizationId}:${auth.user.id}:${input.idempotencyKey}`]);
    const replay=(await tx.query<{previewId:string;revisionId:string;resourceId:string}>(`select id as "previewId",published_revision_id as "revisionId",resource_id as "resourceId" from public.shared_dtsi_publication_previews
      where organization_id=$1 and actor_user_id=$2 and idempotency_key=$3`,[organizationId,auth.user.id,input.idempotencyKey])).rows[0];
    if (replay) {
      if (replay.previewId!==input.previewId || replay.resourceId!==resourceId) throw conflict("此重试标识已用于另一份发布预览。");
      return {item:await getSharedDtsiVersion(tx,auth,resourceId,replay.revisionId),replayed:true};
    }
    const frozen=(await tx.query<PreviewRow>(`select ${previewColumns} from public.shared_dtsi_publication_previews
      where id=$1 and resource_id=$2 and organization_id=$3 and actor_user_id=$4`,[input.previewId,resourceId,organizationId,auth.user.id])).rows[0];
    if (!frozen) throw new ApiError("NOT_FOUND","发布预览不存在。");
    if (frozen.publishedRevisionId || frozen.actorFingerprint!==actorFingerprint(auth)) throw conflict();
    // Preview intent is immutable; serialize on the draft before touching preview completion,
    // matching discard's draft -> resource -> preview-cascade order.
    let draft:SharedDtsiDraft;
    try { await lockDraft(tx,auth,resourceId,frozen.draftRevision); draft=await getSharedDtsiDraft(tx,auth,resourceId); }
    catch (error) { if (error instanceof ApiError && ["NOT_FOUND","CONFLICT"].includes(error.code)) throw conflict(); throw error; }
    const current=await currentVersion(tx,auth,resourceId);
    if (draft.id!==frozen.draftId || (current?.id??null)!==frozen.baseVersionId || (await completePublicationSource(tx,auth,draft)).digest!==frozen.digest) throw conflict();
    const revisionId=randomUUID(),version=(current?.version??0)+1;
    await tx.query(`insert into public.shared_dtsi_revisions(id,resource_id,organization_id,version,name,draft_revision,change_description,manifest,digest,created_by_user_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,[revisionId,resourceId,organizationId,version,frozen.name,frozen.draftRevision,
      frozen.changeDescription,JSON.stringify(frozen.manifest),frozen.digest,auth.user.id]);
    for (const member of frozen.members) await tx.query(`insert into public.shared_dtsi_revision_members
      (revision_id,member_id,resource_id,organization_id,source_name,content,checksum,size_bytes) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [revisionId,member.id,resourceId,organizationId,member.sourceName,member.content,member.checksum,member.sizeBytes]);
    await tx.query("delete from public.shared_dtsi_drafts where id=$1 and organization_id=$2",[draft.id,organizationId]);
    await tx.query("update public.shared_dtsi_resources set updated_at=now() where id=$1 and organization_id=$2",[resourceId,organizationId]);
    await tx.query("update public.shared_dtsi_publication_previews set idempotency_key=$2,published_revision_id=$3 where id=$1",[frozen.id,input.idempotencyKey,revisionId]);
    await writeAuditEventInTx(asAuditTx(tx),invocation,{requestId:context.requestId},{app:"parameters",kind:"shared-dtsi-publication",action:"publish",severity:"Medium",
      projectId:null,targetType:"shared-dtsi-resource",targetId:resourceId,metadata:{revisionId,version,digest:frozen.digest}});
    return {item:await getSharedDtsiVersion(tx,auth,resourceId,revisionId),replayed:false};
  });
}
export async function createSharedDtsiVersionDraft(db:Database,auth:AuthContext,resourceId:string,baseVersionId:string,context:WriteContext) {
  const invocation=requireWrite(auth,context),organizationId=parameterOrganizationId(auth);
  return db.transaction(async tx=>{
    const resource=(await tx.query("select id from public.shared_dtsi_resources where id=$1 and organization_id=$2 for update",[resourceId,organizationId])).rows[0];
    if (!resource) throw new ApiError("NOT_FOUND","共享 DTSI 资源不存在。");
    const current=await currentVersion(tx,auth,resourceId);
    if (current?.id!==baseVersionId) throw conflict("当前共享版本已变化，请返回最新版本创建草稿。");
    if ((await tx.query("select 1 from public.shared_dtsi_drafts where resource_id=$1 and organization_id=$2",[resourceId,organizationId])).rows.length)
      throw conflict("此资源已有草稿，请继续编辑现有草稿。");
    const version=await getSharedDtsiVersion(tx,auth,resourceId,baseVersionId),draftId=randomUUID();
    const buildInputs = {includeSearchPaths:version.manifest.buildInputs.includeSearchPaths,defines:version.manifest.buildInputs.defines ?? {}};
    await tx.query("insert into public.shared_dtsi_drafts(id,resource_id,organization_id,created_by_user_id,updated_by_user_id,build_inputs) values ($1,$2,$3,$4,$4,$5::jsonb)",[draftId,resourceId,organizationId,auth.user.id,JSON.stringify(buildInputs)]);
    await tx.query("update public.shared_dtsi_drafts set dependencies=$2::jsonb where id=$1",[draftId,JSON.stringify(version.manifest.dependencies??[])]);
    for (const member of version.members) await tx.query(`insert into public.shared_dtsi_draft_members(draft_id,member_id,resource_id,organization_id,source_name,content)
      values ($1,$2,$3,$4,$5,$6)`,[draftId,member.id,resourceId,organizationId,member.sourceName,member.content]);
    await writeAuditEventInTx(asAuditTx(tx),invocation,{requestId:context.requestId},{app:"parameters",kind:"shared-dtsi-draft",action:"create-version",severity:"Medium",
      projectId:null,targetType:"shared-dtsi-resource",targetId:resourceId,metadata:{baseVersionId}});
    return getSharedDtsiDraft(tx,auth,resourceId);
  });
}
