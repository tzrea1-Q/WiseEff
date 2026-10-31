import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { canAdminParameters, canViewParameters } from "../parameter-kernel/policy";
import { parameterOrganizationId, parameterScopeInvocation } from "../parameters/operatingScope";
import type { SharedDtsiDraft, SharedDtsiDraftInput, SharedDtsiResourceSummary } from "../contracts/dtoSchemas/sharedDtsi";
import { sharedDtsiImportLimits } from "../contracts/dtoSchemas/sharedDtsi";
import { sharedDtsiManifestSchema } from "../contracts/dtoSchemas/sharedDtsi";
import { assertSharedDtsiNewReferences, lockSharedDtsiReferences } from "./lifecycle";
import { loadSharedDtsiClosure } from "./dependencies";

export type WriteContext = { invocation: TrustedInvocationContext; requestId: string };
type DraftRow = Omit<SharedDtsiDraft, "members" | "updatedAt"> & { updatedAt: Date };
const draftColumns = `d.id,d.resource_id as "resourceId",r.name,d.revision,d.updated_at as "updatedAt",d.change_description as "changeDescription",d.build_inputs as "buildInputs",d.dependencies,d.source_origin->'evidence' as "sourceEvidence"`;
const draftTables = `from public.shared_dtsi_resources r join public.shared_dtsi_drafts d on d.resource_id=r.id and d.organization_id=r.organization_id`;
// Immutable legacy search projection only; every read still authorizes its resource, and authoring re-reads source evidence.
const legacySelectorCache=new WeakMap<Database,Map<string,string[]>>();

export function requireRead(auth: AuthContext) {
  if (!auth.user.isActive || (!canViewParameters(auth) && !canAdminParameters(auth))) throw new ApiError("FORBIDDEN", "没有共享 DTSI 的查看权限。");
}
export function requireWrite(auth: AuthContext, context: WriteContext) {
  if (!auth.user.isActive || !canAdminParameters(auth)) throw new ApiError("FORBIDDEN", "只有参数管理员可以修改共享 DTSI。");
  const invocation = parameterScopeInvocation(auth, context.invocation, "shared DTSI draft");
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "共享 DTSI 修改需要用户操作。");
  return invocation;
}
function audit(db: Database, auth: AuthContext, context: WriteContext, resourceId: string, action: string, revision: number) {
  return writeAuditEventInTx(asAuditTx(db), requireWrite(auth, context), { requestId: context.requestId }, {
    app: "parameters", kind: "shared-dtsi-draft", action, severity: "Medium", projectId: null,
    targetType: "shared-dtsi-resource", targetId: resourceId, metadata: { revision }
  });
}
export async function getSharedDtsiDraft(db: Database, auth: AuthContext, resourceId: string): Promise<SharedDtsiDraft> {
  requireRead(auth);
  const row = (await db.query<DraftRow & Pick<SharedDtsiDraft, "members">>(`select ${draftColumns},
    (select jsonb_agg(jsonb_build_object('id',m.member_id,'sourceName',m.source_name,'content',m.content) order by m.source_name,m.member_id)
      from public.shared_dtsi_draft_members m where m.draft_id=d.id and m.organization_id=d.organization_id) as members
    ${draftTables} where r.id=$1 and r.organization_id=$2`, [resourceId, parameterOrganizationId(auth)])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "共享 DTSI 草稿不存在。");
  const { buildInputs, ...draft } = row;
  return { ...draft, ...(buildInputs && (buildInputs.includeSearchPaths.length || Object.keys(buildInputs.defines).length) ? { buildInputs } : {}), updatedAt: row.updatedAt.toISOString() };
}
export async function listSharedDtsiResources(db: Database, auth: AuthContext, input: { q: string; offset: number; limit: number }) {
  requireRead(auth);
  if (input.q) {
    const {getSharedDtsiVersion,preparePublishedSharedDtsiSource} = await import("./publication");
    const matches: SharedDtsiResourceSummary[] = [];
    // ponytail: linear metadata scan; frozen selectors avoid recompiling current resources, add a SQL index when library size warrants it.
    for (let offset=0;;offset+=100) {
      const page = await listSharedDtsiResources(db,auth,{q:"",offset,limit:100});
      for (const row of page.items) {
        const needle=input.q.toLowerCase();
        if ([row.name,row.sourceName].some(value=>value.toLowerCase().includes(needle))) { matches.push(row);continue; }
        const paths = await db.query<{sourceName:string}>(`select source_name as "sourceName" from public.shared_dtsi_draft_members
          where resource_id=$1 and organization_id=$2 union select source_name from public.shared_dtsi_revision_members where revision_id=$3 and organization_id=$2`,
          [row.resourceId,parameterOrganizationId(auth),row.currentVersion?.id??null]);
        if (paths.rows.some(value=>value.sourceName.toLowerCase().includes(needle))) {matches.push(row);continue;}
        if (row.currentVersion) {
          const raw=(await db.query<{manifest:unknown}>("select manifest from public.shared_dtsi_revisions where id=$1 and resource_id=$2 and organization_id=$3",[row.currentVersion.id,row.resourceId,parameterOrganizationId(auth)])).rows[0];
          if(!raw)throw new ApiError("NOT_FOUND","共享 DTSI 版本不存在。");
          const manifest=sharedDtsiManifestSchema.parse(raw.manifest);
          const cache=legacySelectorCache.get(db)??new Map<string,string[]>();legacySelectorCache.set(db,cache);
          const key=`${parameterOrganizationId(auth)}:${row.currentVersion.id}:${row.currentVersion.digest}`;
          let selectors=manifest.compatibleSelectors??cache.get(key);
          if(!selectors) {
            const version=await getSharedDtsiVersion(db,auth,row.resourceId,row.currentVersion.id);
            selectors=(await preparePublishedSharedDtsiSource(db,auth,version)).manifest.compatibleSelectors??[];
            if(selectors.reduce((bytes,value)=>bytes+Buffer.byteLength(value),0)<=262_144){if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(key,selectors);}
          }
          if(selectors.some(compatible=>compatible.toLowerCase().includes(needle))){matches.push(row);continue;}
        }
        if(row.draftRevision) {
          const preview=(await db.query<{manifest:unknown}>(`select preview.manifest from public.shared_dtsi_publication_previews preview
            join public.shared_dtsi_drafts draft on draft.id=preview.draft_id and draft.resource_id=preview.resource_id
              and draft.organization_id=preview.organization_id and draft.revision=preview.draft_revision
            where preview.resource_id=$1 and preview.organization_id=$2 and draft.revision=$3 order by preview.created_at desc,preview.id desc limit 1`,[row.resourceId,parameterOrganizationId(auth),row.draftRevision])).rows[0];
          if(preview && sharedDtsiManifestSchema.parse(preview.manifest).compatibleSelectors?.some(compatible=>compatible.toLowerCase().includes(needle)))matches.push(row);
        }
      }
      if(offset+page.items.length>=page.total)break;
    }
    return {items:matches.slice(input.offset,input.offset+input.limit),total:matches.length};
  }
  const values = [parameterOrganizationId(auth), input.q];
  const tables = `from public.shared_dtsi_resources r left join public.shared_dtsi_drafts d on d.resource_id=r.id and d.organization_id=r.organization_id
    left join lateral (select id,resource_id,version,name,change_description,digest,created_at,created_by_user_id
      from public.shared_dtsi_revisions where resource_id=r.id and organization_id=r.organization_id order by version desc limit 1) v on true`;
  const filter = ` where r.organization_id=$1 and ($2='' or position(lower($2) in lower(r.name))>0
    or exists(select 1 from public.shared_dtsi_draft_members m where m.draft_id=d.id and position(lower($2) in lower(m.source_name))>0)
    or exists(select 1 from public.shared_dtsi_revision_members m where m.revision_id=v.id and position(lower($2) in lower(m.source_name))>0))`;
  const rows = (await db.query<Omit<SharedDtsiResourceSummary,"updatedAt"> & {updatedAt:Date}>(`select r.id as "resourceId",r.name,r.state,r.lifecycle_revision as "lifecycleRevision",r.updated_at as "updatedAt",d.revision as "draftRevision",
    coalesce((select min(m.source_name) from public.shared_dtsi_revision_members m where m.revision_id=v.id),
      (select min(m.source_name) from public.shared_dtsi_draft_members m where m.draft_id=d.id)) as "sourceName",
    case when v.id is null then null else jsonb_build_object('id',v.id,'resourceId',v.resource_id,'version',v.version,'name',v.name,
      'changeDescription',v.change_description,'digest',v.digest,'createdAt',v.created_at,'createdByUserId',v.created_by_user_id) end as "currentVersion" ${tables}${filter}
    order by r.updated_at desc,r.id limit $3 offset $4`, [...values, input.limit, input.offset])).rows;
  const total = (await db.query<{ count: string }>(`select count(*) ${tables}${filter}`, values)).rows[0]!.count;
  return { items: rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) satisfies SharedDtsiResourceSummary[], total: Number(total) };
}
export async function createSharedDtsiDraft(db: Database, auth: AuthContext, input: SharedDtsiDraftInput, context: WriteContext) {
  requireWrite(auth, context);
  const members = inputMembers(input);
  return db.transaction(async tx => {
    const organizationId = parameterOrganizationId(auth), resourceId = randomUUID(), draftId = randomUUID();
    await lockSharedDtsiReferences(tx,auth);
    await assertSharedDtsiNewReferences(tx,auth,await loadSharedDtsiClosure(tx,auth,input.dependencies??[],resourceId));
    await tx.query("insert into public.shared_dtsi_resources(id,organization_id,name) values ($1,$2,$3)", [resourceId, organizationId, input.name]);
    await tx.query("insert into public.shared_dtsi_drafts(id,resource_id,organization_id,created_by_user_id,updated_by_user_id,change_description,build_inputs) values ($1,$2,$3,$4,$4,$5,$6::jsonb)", [draftId, resourceId, organizationId, auth.user.id,input.changeDescription,JSON.stringify(input.buildInputs ?? {includeSearchPaths:[],defines:{}})]);
    await tx.query("update public.shared_dtsi_drafts set dependencies=$2::jsonb where id=$1",[draftId,JSON.stringify(input.dependencies??[])]);
    for (const member of members) {
      if (member.id) throw new ApiError("VALIDATION_FAILED", "新资源不能指定已有成员身份。");
      const memberId = randomUUID();
      await tx.query("insert into public.shared_dtsi_members(id,resource_id,organization_id) values ($1,$2,$3)", [memberId, resourceId, organizationId]);
      await tx.query("insert into public.shared_dtsi_draft_members(draft_id,member_id,resource_id,organization_id,source_name,content) values ($1,$2,$3,$4,$5,$6)", [draftId, memberId, resourceId, organizationId, member.sourceName, member.content]);
    }
    await audit(tx, auth, context, resourceId, "create", 1);
    return getSharedDtsiDraft(tx, auth, resourceId);
  });
}
export function inputMembers(input: SharedDtsiDraftInput) {
  const members = input.members ?? [{sourceName:input.sourceName,content:input.content,id:undefined}];
  const paths = new Set<string>(), ids = new Set<string>();
  let bytes = 0;
  for (const member of members) {
    const path = member.sourceName.normalize("NFC");
    if (paths.has(path) || member.id && ids.has(member.id)) throw new ApiError("VALIDATION_FAILED", `${member.sourceName}：文件路径或成员身份重复。`);
    paths.add(path); if (member.id) ids.add(member.id);
    bytes += Buffer.byteLength(member.content);
  }
  if (bytes > sharedDtsiImportLimits.maxTotalBytes) throw new ApiError("VALIDATION_FAILED", "资源源码总量不能超过 16 MiB。");
  if (!members.some(member=>/\.dtsi?$/u.test(member.sourceName))) throw new ApiError("VALIDATION_FAILED", "资源至少需要一个 .dts 或 .dtsi 源码成员；头文件单独保存为依赖。");
  return members;
}
export async function lockDraft(db: Database, auth: AuthContext, resourceId: string, expectedRevision: number) {
  await lockSharedDtsiReferences(db,auth);
  const row = (await db.query<{ id: string; revision: number }>(`select d.id,d.revision from public.shared_dtsi_drafts d
    where d.resource_id=$1 and d.organization_id=$2 for update`, [resourceId, parameterOrganizationId(auth)])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "共享 DTSI 草稿不存在。");
  if (row.revision !== expectedRevision) throw new ApiError("CONFLICT", "草稿已被更新，请重新载入后核对；本地修改仍保留。", { reason: "draft-revision-changed", currentRevision: row.revision });
  return row;
}
export async function saveSharedDtsiDraft(db: Database, auth: AuthContext, resourceId: string, input: SharedDtsiDraftInput & { expectedRevision: number }, context: WriteContext) {
  requireWrite(auth, context);
  const members = inputMembers(input);
  return db.transaction(async tx => {
    const draft = await lockDraft(tx, auth, resourceId, input.expectedRevision), organizationId = parameterOrganizationId(auth);
    await tx.query("update public.shared_dtsi_resources set name=$3,updated_at=now() where id=$1 and organization_id=$2", [resourceId, organizationId, input.name]);
    const previous = await getSharedDtsiDraft(tx,auth,resourceId);
    await assertSharedDtsiNewReferences(tx,auth,await loadSharedDtsiClosure(tx,auth,input.dependencies??[],resourceId),
      await loadSharedDtsiClosure(tx,auth,previous.dependencies??[],resourceId));
    if (!input.members && previous.members.length !== 1) throw new ApiError("VALIDATION_FAILED", "多文件资源必须提交完整成员集合，不能用单文件保存覆盖。");
    const assigned = members.map(member=>({...member,id:member.id ?? previous.members.find(old=>old.sourceName===member.sourceName)?.id
      ?? (!input.members ? previous.members[0]!.id : randomUUID())}));
    if (new Set(assigned.map(member=>member.id)).size!==assigned.length) throw new ApiError("VALIDATION_FAILED","成员重命名与原路径匹配发生身份冲突，请明确每个成员身份后重试。");
    const known = new Set(previous.members.map(member=>member.id));
    for (const member of assigned) {
      if (members.find(value=>value.id===member.id) && !known.has(member.id)) throw new ApiError("VALIDATION_FAILED", `${member.sourceName}：成员身份不属于当前草稿。`);
      if (!known.has(member.id)) await tx.query("insert into public.shared_dtsi_members(id,resource_id,organization_id) values ($1,$2,$3)",[member.id,resourceId,organizationId]);
    }
    await tx.query("delete from public.shared_dtsi_draft_members where draft_id=$1 and organization_id=$2",[draft.id,organizationId]);
    for (const member of assigned) await tx.query("insert into public.shared_dtsi_draft_members(draft_id,member_id,resource_id,organization_id,source_name,content) values ($1,$2,$3,$4,$5,$6)",[draft.id,member.id,resourceId,organizationId,member.sourceName,member.content]);
    await tx.query("update public.shared_dtsi_drafts set revision=revision+1,updated_by_user_id=$3,updated_at=now(),change_description=$4,build_inputs=$5::jsonb where id=$1 and organization_id=$2", [draft.id, organizationId, auth.user.id,input.changeDescription,JSON.stringify(input.buildInputs ?? {includeSearchPaths:[],defines:{}})]);
    await tx.query("update public.shared_dtsi_drafts set dependencies=$2::jsonb where id=$1",[draft.id,JSON.stringify(input.dependencies??[])]);
    await audit(tx, auth, context, resourceId, "save", draft.revision + 1);
    return getSharedDtsiDraft(tx, auth, resourceId);
  });
}
export async function discardSharedDtsiDraft(db: Database, auth: AuthContext, resourceId: string, expectedRevision: number, context: WriteContext) {
  requireWrite(auth, context);
  return db.transaction(async tx => {
    const draft = await lockDraft(tx, auth, resourceId, expectedRevision);
    const published = (await tx.query<{name:string}>("select name from public.shared_dtsi_revisions where resource_id=$1 and organization_id=$2 order by version desc limit 1",[resourceId,parameterOrganizationId(auth)])).rows[0];
    await tx.query(published ? "delete from public.shared_dtsi_drafts where resource_id=$1 and organization_id=$2"
      : "delete from public.shared_dtsi_resources where id=$1 and organization_id=$2", [resourceId, parameterOrganizationId(auth)]);
    if (published) await tx.query("update public.shared_dtsi_resources set name=$3,updated_at=now() where id=$1 and organization_id=$2",[resourceId,parameterOrganizationId(auth),published.name]);
    await audit(tx, auth, context, resourceId, "discard", draft.revision);
    return { ok: true };
  });
}
