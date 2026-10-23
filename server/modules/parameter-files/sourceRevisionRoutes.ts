import { parameterOrganizationId, parameterInvocation, parameterRequestAccess } from "../parameters/operatingScope";
import { z } from "zod";
import { historicalIdentityLabel, type HistoricalAttribution } from "../../../src/domain/identity/historicalAttribution";
import { getRootPostgresPool, isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { asAuditTx } from "../audit/auditedWrite";
import { assertTrustedRefusalAuditSink, createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { getAuthContext } from "../auth/repository";
import type { ObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { requireCanViewProject } from "../parameter-topology/service";
import { getProjectById } from "../projects/repository";
import { recordCanonicalPermissionRefusal, requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { MAX_PARAMETER_SOURCE_BYTES } from "./jsonSource";
import { applySourceRevisionCandidate, commitSourceRevision } from "./sourceRevisionCommit";
import { sourceRevisionDirectApplyRequestSchema } from "../contracts/dtoSchemas/sourceRevision";
import { isCurrentSourceAdministrator, isSourceRevisionReviewer, loadSourceRevisionCatalogSnapshots, requireCurrentSourceAdministrator, sourceRevisionDigest, sourceRevisionReviewers, type SourceRevisionProof } from "./sourceRevisionService";

type Status = "pending" | "approved" | "rejected" | "withdrawn";
export type SourceRevisionRequestDto = {
  id: string; projectId: string; candidateId: string; fileId: string; fileName: string; configSetId: string;
  status: Status; reason: string; submitterUserId: string | null; assignedToUserId: string | null; reviewerUserId: string | null;
  submitterName?: string | null; assignedToName?: string | null; reviewerName?: string | null;
  organizationName?: string | null;
  reviewerNote: string | null; createdAt: string; updatedAt: string; proofDigest: string;
  impact: { parameterChanges: number; nodeAdditions: number; nodeRemovals: number; restoredParameters?: number };
  before?: string; after?: string;
  appliedSourceResult?: { configRevisionId: string; fileVersionId: string } | null;
  applicationMode: "separate_review" | "administrator_direct";
  canAdminister?: boolean;
  eligibleReviewers?: Array<{ userId: string; name: string }>;
  cancellation?: { userId: string | null; name: string | null; reason: string } | null;
};
type Row = {
  id: string; project_id: string; candidate_id: string; source_file_id: string; source_file_name: string;
  source_revision_config_set_id: string; source_revision_proof_digest: string;
  source_revision_context: SourceRevisionProof; status: Status; reason: string;
  submitter_user_id: string | null; assigned_to_user_id: string | null; reviewer_user_id: string | null;
  submitter_name: string | null; assigned_to_name: string | null; reviewer_name: string | null;
  historical_attribution?: HistoricalAttribution;
  reviewer_note: string | null; created_at: Date | string; updated_at: Date | string;
  applied_source_result: SourceRevisionRequestDto["appliedSourceResult"];
  source_revision_application_mode: SourceRevisionRequestDto["applicationMode"];
  before_storage_key: string | null; after_storage_key: string | null;
  before_checksum: string | null; after_checksum: string | null; node_removals: number; node_additions?: number;
  cancellation_user_id: string | null; cancellation_name: string | null; cancellation_reason: string | null;
};
const paramsSchema = z.object({ projectId: z.string().min(1), requestId: z.string().min(1) });
const querySchema = z.object({ mine: z.enum(["true", "false"]).optional(), status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional() }).strict();
const reviewSchema = z.object({ decision: z.enum(["approve", "reject"]), proofDigest: z.string().regex(/^[0-9a-f]{64}$/), note: z.string().trim().max(2000).optional() }).strict();
export const sourceRequestCancelSchema = z.object({ proofDigest: z.string().regex(/^[0-9a-f]{64}$/),
  expectedAssignedToUserId: z.string().min(1).nullable(),reason: z.string().trim().min(1).max(2000) }).strict();
export const sourceRequestReassignSchema = sourceRequestCancelSchema.omit({ reason: true }).extend({ assignedToUserId: z.string().min(1) }).strict();
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION_FAILED", "Invalid whole-source request input.", { issues: result.error.issues });
  return result.data;
}

const selection = `select request.*, candidate.file_id as source_file_id, candidate.file_name as source_file_name,
  candidate.storage_key as after_storage_key,candidate.checksum as after_checksum,
  base.storage_key as before_storage_key,base.checksum as before_checksum,
  case when request.historical_attribution->'actors'->'submitter_user_id'->>'source' = 'legacy-current'
    then (request.historical_attribution->'actors'->'submitter_user_id'->>'name') || '（迁移时名称）'
    else request.historical_attribution->'actors'->'submitter_user_id'->>'name' end as submitter_name,
  assignee.name as assigned_to_name,
  case when request.historical_attribution->'actors'->'reviewer_user_id'->>'source' = 'legacy-current'
    then (request.historical_attribution->'actors'->'reviewer_user_id'->>'name') || '（迁移时名称）'
    else request.historical_attribution->'actors'->'reviewer_user_id'->>'name' end as reviewer_name,
  cancellation.actor_user_id as cancellation_user_id,cancellation.metadata->>'administratorName' as cancellation_name,
  cancellation.metadata->>'reason' as cancellation_reason,
  (select count(*)::int from public.dts_logical_node_revisions node
    where node.config_revision_id=request.source_revision_context->>'baseConfigRevisionId'
      and not exists(select 1 from jsonb_array_elements(request.source_revision_context->'continuity'->'nodes') planned
        where planned->>'logicalNodeId'=node.logical_node_id)) as node_removals,
  (select count(*)::int from jsonb_array_elements(request.source_revision_context->'continuity'->'nodes') planned
    where not exists(select 1 from public.dts_logical_node_revisions node
      where node.config_revision_id=request.source_revision_context->>'baseConfigRevisionId'
        and node.logical_node_id=planned->>'logicalNodeId')) as node_additions
  from public.project_parameter_value_change_requests request
  join public.project_parameter_file_candidates candidate on candidate.id=request.candidate_id
    and candidate.organization_id=request.organization_id and candidate.project_id=request.project_id
  join public.project_parameter_files file on file.id=candidate.file_id
    and file.organization_id=request.organization_id and file.project_id=request.project_id
  left join public.project_parameter_file_versions base on base.id=request.source_revision_context->>'baseVersionId'
    and base.file_id=candidate.file_id
  left join public.users assignee on assignee.id=request.assigned_to_user_id and assignee.organization_id=request.organization_id
  left join lateral (select audit.actor_user_id,audit.metadata from public.audit_events audit
    where audit.organization_id=request.organization_id and audit.project_id=request.project_id and audit.target_id=request.id
      and audit.target_type='project-parameter-value-change-request' and audit.action='source-request-cancelled'
      and audit.metadata->>'proofDigest'=request.source_revision_proof_digest and request.status='withdrawn'
    order by audit.created_at desc,audit.id desc limit 1) cancellation on true`;

async function ownedProject(db: Database, auth: AuthContext, projectId: string): Promise<void> {
  if (!auth.user.isActive) throw new ApiError("FORBIDDEN", "An active user is required.");
  requireCanViewProject(auth, projectId);
  if (!await getProjectById(db, { organizationId: parameterOrganizationId(auth), projectId })) throw new ApiError("NOT_FOUND", "Project was not found.");
}
async function load(db: Database, auth: AuthContext, projectId: string, requestId: string, lock = false): Promise<Row | null> {
  if (lock) return (await db.query<Row>(`${selection}
    where request.organization_id=$1 and request.project_id=$2 and request.id=$3 and request.request_kind='source_revision'
    for update of request`, [parameterOrganizationId(auth), projectId, requestId])).rows[0] ?? null;
  return (await db.query<Row>(`${selection}
    where request.organization_id=$1 and request.project_id=$2 and request.id=$3 and request.request_kind='source_revision'`,
    [parameterOrganizationId(auth), projectId, requestId])).rows[0] ?? null;
}
function frozenProof(row: Row, auth: AuthContext): SourceRevisionProof {
  const proof = row.source_revision_context;
  if (!proof || proof.kind !== "source_revision" || proof.organizationId !== parameterOrganizationId(auth)
    || proof.projectId !== row.project_id || proof.fileId !== row.source_file_id || proof.candidateId !== row.candidate_id
    || proof.configSetId !== row.source_revision_config_set_id || proof.proofDigest !== row.source_revision_proof_digest
    || !Array.isArray(proof.targets) || !Array.isArray(proof.newProperties) || !Array.isArray(proof.continuity?.nodes)) {
    throw new ApiError("CONFLICT", "The frozen source request ownership context is inconsistent.");
  }
  const { proofDigest, ...facts } = proof;
  if (sourceRevisionDigest(facts) !== proofDigest) throw new ApiError("CONFLICT", "The frozen source request digest is inconsistent.");
  return proof;
}
function dto(row: Row, auth: AuthContext): SourceRevisionRequestDto {
  const proof = frozenProof(row, auth);
  return {
    id: row.id, projectId: row.project_id, candidateId: row.candidate_id, fileId: row.source_file_id,
    fileName: row.source_file_name, configSetId: row.source_revision_config_set_id, status: row.status, reason: row.reason,
    submitterUserId: row.submitter_user_id, assignedToUserId: row.assigned_to_user_id, reviewerUserId: row.reviewer_user_id,
    submitterName: row.submitter_name, assignedToName: row.assigned_to_name, reviewerName: row.reviewer_name,
    ...(row.historical_attribution ? { organizationName: row.historical_attribution.organization.name
      ? historicalIdentityLabel(row.historical_attribution.organization) : null } : {}),
    reviewerNote: row.reviewer_note, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), proofDigest: proof.proofDigest,
    impact: { parameterChanges: proof.targets.length + proof.newProperties.length,
      restoredParameters: proof.restorations?.length ?? 0,
      nodeAdditions: Number(row.node_additions ?? proof.continuity.nodes.filter((node) => node.isNew).length), nodeRemovals: Number(row.node_removals) },
    appliedSourceResult: row.applied_source_result, applicationMode: row.source_revision_application_mode,
    cancellation: row.cancellation_reason ? { userId: row.cancellation_user_id,name: row.cancellation_name,reason: row.cancellation_reason } : null
  };
}
async function withSource(row: Row, auth: AuthContext, storage: ObjectStore | undefined): Promise<SourceRevisionRequestDto> {
  const item = dto(row, auth);
  const proof = row.source_revision_context;
  if (!storage?.getBounded || !row.before_storage_key || !row.after_storage_key
    || row.before_checksum?.replace(/^sha256:/, "") !== proof.baseDigest
    || row.after_checksum?.replace(/^sha256:/, "") !== proof.proposedDigest) {
    throw new ApiError("CONFLICT", "Frozen source bytes are unavailable or inconsistent.");
  }
  const [before, after] = await Promise.all([storage.getBounded(row.before_storage_key, MAX_PARAMETER_SOURCE_BYTES), storage.getBounded(row.after_storage_key, MAX_PARAMETER_SOURCE_BYTES)]);
  if (before.length > MAX_PARAMETER_SOURCE_BYTES || after.length > MAX_PARAMETER_SOURCE_BYTES
    || sourceRevisionDigest(before) !== proof.baseDigest || sourceRevisionDigest(after) !== proof.proposedDigest) {
    throw new ApiError("CONFLICT", "Frozen source bytes do not match the reviewed digests.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return { ...item, before: decoder.decode(before), after: decoder.decode(after) };
}

export function registerSourceRevisionRoutes(router: WiseEffRouter, options: {
  db?: Database;
  objectStore?: ObjectStore;
  refusalAuditSink?: TrustedRefusalAuditSink;
  getCurrentAuthContext(request: RouteRequest): Promise<AuthContext> | AuthContext;
}): void {
  const refusalSink = options.refusalAuditSink
    ? (assertTrustedRefusalAuditSink(options.refusalAuditSink), options.refusalAuditSink)
    : options.db && isRootDatabase(options.db) ? createTrustedRefusalAuditSink(options.db) : undefined;
  function database(): Database {
    if (!options.db) throw new ApiError("INTERNAL_ERROR", "Whole-source requests require a database.");
    return options.db;
  }
  function security(auth: AuthContext, request: RouteRequest): CanonicalSourceSecurityContext {
    if (!refusalSink) throw new ApiError("INTERNAL_ERROR", "Whole-source requests require a trusted refusal audit sink.");
    return { invocation: parameterInvocation(auth) ?? createUserInvocation(auth), requestId: request.requestId, refusalSink };
  }
  const path = "/api/v2/projects/:projectId/source-revision-requests";
  router.post("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/source-apply", async (request) => {
    const db = database(), auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const params = parse(z.object({ projectId: z.string().min(1), candidateId: z.string().min(1) }), request.params);
    const body = parse(sourceRevisionDirectApplyRequestSchema, request.body);
    const context = security(auth, request);
    await ownedProject(db, auth, params.projectId);
    if (!options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source application requires source storage.");
    const result = await applySourceRevisionCandidate(db, options.objectStore, auth, { ...params, ...body }, context);
    const row = await load(db, auth, params.projectId, result.requestId);
    if (!row) throw new ApiError("CONFLICT", "Source application receipt is unavailable.");
    return { status: 200, body: { item: dto(row, auth) } };
  });
  router.get(path, async (request) => {
    const db = database(), auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const { projectId } = parse(z.object({ projectId: z.string().min(1) }), request.params);
    const query = parse(querySchema, Object.fromEntries(Object.entries(request.query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
    await ownedProject(db, auth, projectId);
    const reviewer = query.mine !== "true" && await isSourceRevisionReviewer(db, auth, projectId);
    const administrator = query.mine !== "true" && await isCurrentSourceAdministrator(db,auth,projectId);
    const rows = await db.query<Row>(`${selection}
      where request.organization_id=$1 and request.project_id=$2 and request.request_kind='source_revision'
        and ($3::text is null or request.status=$3)
        and (request.submitter_user_id=$4 or ($5::boolean and request.assigned_to_user_id=$4) or $6::boolean)
      order by request.updated_at desc,request.id`, [parameterOrganizationId(auth), projectId, query.status ?? null, auth.user.id, reviewer,administrator]);
    return { status: 200, body: { items: rows.rows.map((row) => dto(row, auth)) } };
  });
  router.get(`${path}/:requestId`, async (request) => {
    const db = database(), auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const params = parse(paramsSchema, request.params);
    await ownedProject(db, auth, params.projectId);
    const row = await load(db, auth, params.projectId, params.requestId);
    const administrator = await isCurrentSourceAdministrator(db,auth,params.projectId);
    if (!row || (row.submitter_user_id !== auth.user.id
      && !administrator && (row.assigned_to_user_id !== auth.user.id || !await isSourceRevisionReviewer(db, auth, params.projectId)))) {
      throw new ApiError("NOT_FOUND", "Whole-source request was not found.");
    }
    return { status: 200, body: { item: { ...await withSource(row, auth, options.objectStore),canAdminister: administrator,
      ...(administrator && row.status === "pending" ? { eligibleReviewers: await sourceRevisionReviewers(db,auth,params.projectId,row.submitter_user_id) } : {}) } } };
  });
  router.post(`${path}/:requestId/cancel`, async (request) => {
    const db = database(),auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const params = parse(paramsSchema,request.params),body = parse(sourceRequestCancelSchema,request.body);
    const context = security(auth,request);
    await requireCanonicalUserInvocation(auth,context,{ projectId: params.projectId,operation: "source request administration",
      targetType: "project-parameter-value-change-request",targetId: params.requestId });
    await ownedProject(db,auth,params.projectId);
    const item = await db.transaction(async (tx) => {
      const administrator = await requireCurrentSourceAdministrator(tx,auth,params.projectId);
      const row = await load(tx,administrator,params.projectId,params.requestId,true);
      if (!row) throw new ApiError("NOT_FOUND","源码请求不存在。");
      frozenProof(row,administrator);
      if (row.source_revision_proof_digest !== body.proofDigest || row.assigned_to_user_id !== body.expectedAssignedToUserId) {
        throw new ApiError("CONFLICT","源码请求的指派或固定差异已变化，请刷新后重试。");
      }
      if (row.status === "withdrawn" && row.cancellation_user_id === administrator.user.id && row.cancellation_reason === body.reason) return dto(row,administrator);
      if (row.status !== "pending" || row.source_revision_application_mode !== "separate_review") throw new ApiError("CONFLICT","源码请求已终结，不能取消。");
      await writeTrustedGovernanceAudit(asAuditTx(tx),context.invocation,{ action: "source-request-cancelled",organizationId: parameterOrganizationId(administrator),
        projectId: params.projectId,targetType: "project-parameter-value-change-request",targetId: row.id,
        metadata: { requestKind: "source_revision",proofDigest: row.source_revision_proof_digest,reason: body.reason,
          administratorName: administrator.user.name,fromAssignedToUserId: row.assigned_to_user_id } },request.requestId);
      await tx.query(`update public.project_parameter_value_change_requests set status='withdrawn',updated_at=now()
        where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision' and status='pending'`,
        [row.id,parameterOrganizationId(administrator),params.projectId]);
      const updated = await load(tx,administrator,params.projectId,params.requestId);
      if (!updated) throw new ApiError("CONFLICT","源码请求的取消回执不可用。");
      return dto(updated,administrator);
    });
    return { status: 200,body: { item } };
  });
  router.post(`${path}/:requestId/reassign`, async (request) => {
    const db = database(),auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const params = parse(paramsSchema,request.params),body = parse(sourceRequestReassignSchema,request.body);
    const context = security(auth,request);
    await requireCanonicalUserInvocation(auth,context,{ projectId: params.projectId,operation: "source request administration",
      targetType: "project-parameter-value-change-request",targetId: params.requestId });
    await ownedProject(db,auth,params.projectId);
    const item = await db.transaction(async (tx) => {
      // Both authority fences precede the request lock. Sorting also prevents
      // administrators assigning each other from acquiring opposite user locks.
      await tx.query(`select id from public.users where organization_id=$1 and id=any($2::text[])
        order by id for no key update`,[parameterOrganizationId(auth),[auth.user.id,body.assignedToUserId].sort()]);
      const administrator = await requireCurrentSourceAdministrator(tx,auth,params.projectId);
      const assignee = await getAuthContext(tx,body.assignedToUserId).catch((error: unknown) => {
        if (error instanceof ApiError && ["UNAUTHENTICATED","FORBIDDEN","NOT_FOUND"].includes(error.code)) return null;
        throw error;
      });
      if (!assignee || assignee.organization.id !== parameterOrganizationId(administrator) || !await isSourceRevisionReviewer(tx,assignee,params.projectId)) {
        throw new ApiError("VALIDATION_FAILED","所选成员已不具备当前项目的源码审核资格，请刷新后选择其他审核人。");
      }
      const row = await load(tx,administrator,params.projectId,params.requestId,true);
      if (!row) throw new ApiError("NOT_FOUND","源码请求不存在。");
      frozenProof(row,administrator);
      if (row.status !== "pending" || row.source_revision_application_mode !== "separate_review") throw new ApiError("CONFLICT","源码请求已终结，不能重新指派。");
      if (row.submitter_user_id === body.assignedToUserId) throw new ApiError("VALIDATION_FAILED","提交人不能审核自己的源码请求，请选择其他审核人。");
      if (row.source_revision_proof_digest !== body.proofDigest) throw new ApiError("CONFLICT","固定源码差异已变化，请刷新后重试。");
      if (row.assigned_to_user_id === body.assignedToUserId && (await tx.query(`select id from public.audit_events
        where organization_id=$1 and project_id=$2 and target_id=$3 and actor_user_id=$4 and action='source-request-reassigned'
          and metadata->>'proofDigest'=$5 and metadata->>'fromAssignedToUserId' is not distinct from $6::text
          and metadata->>'toAssignedToUserId'=$7`,[parameterOrganizationId(administrator),params.projectId,row.id,administrator.user.id,
        body.proofDigest,body.expectedAssignedToUserId,body.assignedToUserId])).rows.length) return dto(row,administrator);
      if (row.assigned_to_user_id !== body.expectedAssignedToUserId) throw new ApiError("CONFLICT","源码请求的审核人已变化，请刷新后重试。");
      if (row.assigned_to_user_id !== body.assignedToUserId) {
        await writeTrustedGovernanceAudit(asAuditTx(tx),context.invocation,{ action: "source-request-reassigned",organizationId: parameterOrganizationId(administrator),
          projectId: params.projectId,targetType: "project-parameter-value-change-request",targetId: row.id,
          metadata: { requestKind: "source_revision",proofDigest: row.source_revision_proof_digest,
            fromAssignedToUserId: row.assigned_to_user_id,toAssignedToUserId: body.assignedToUserId } },request.requestId);
        await tx.query(`update public.project_parameter_value_change_requests set assigned_to_user_id=$4,updated_at=now()
          where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision' and status='pending'`,
          [row.id,parameterOrganizationId(administrator),params.projectId,body.assignedToUserId]);
      }
      const updated = await load(tx,administrator,params.projectId,params.requestId);
      if (!updated) throw new ApiError("CONFLICT","源码请求的指派回执不可用。");
      return dto(updated,administrator);
    });
    return { status: 200,body: { item } };
  });
  router.post(`${path}/:requestId/review`, async (request) => {
    const db = database(), auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const params = parse(paramsSchema, request.params), body = parse(reviewSchema, request.body);
    const context = security(auth, request);
    await requireCanonicalUserInvocation(auth, context, { projectId: params.projectId, operation: "whole DTS source review", targetType: "project-parameter-value-change-request", targetId: params.requestId });
    await ownedProject(db, auth, params.projectId);
    async function authorizeReview(readDb: Database) {
      const row = await load(readDb, auth, params.projectId, params.requestId);
      if (!row) throw new ApiError("NOT_FOUND", "Whole-source request was not found.");
      if (row.submitter_user_id === auth.user.id || row.assigned_to_user_id !== auth.user.id || !await isSourceRevisionReviewer(readDb, auth, params.projectId)) {
        await recordCanonicalPermissionRefusal(context, { projectId: params.projectId, operation: "whole DTS source review", targetType: "project-parameter-value-change-request", targetId: row.id, details: { reason: "separate-current-assigned-reviewer-required" } });
        throw new ApiError("FORBIDDEN", "A separate assigned file administrator with current software review authority is required.");
      }
      frozenProof(row, auth);
      if (row.source_revision_proof_digest !== body.proofDigest) throw new ApiError("CONFLICT", "The reviewed source proof changed.");
      return row;
    }
    // Catalog loaders use their own pool clients. Load immutable releases before
    // entering the source transaction, then recheck authority and proof inside it.
    const catalog = body.decision === "approve" ? await (async () => {
      await authorizeReview(db);
      const pool = getRootPostgresPool(db);
      if (!pool || !options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source approval requires root Catalog access and source storage.");
      const snapshot = await loadPublishedCatalog(pool);
      return { snapshot, snapshots: await loadSourceRevisionCatalogSnapshots(db, params.projectId, parameterOrganizationId(auth), snapshot) };
    })() : null;
    const item = await db.transaction(async (tx) => {
      // The source owner takes config/file locks before the request lock for approval.
      let row: Row | null = await authorizeReview(tx);
      if (body.decision === "approve") {
        if (!catalog || !options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source approval Catalog context is unavailable.");
        await commitSourceRevision(tx, options.objectStore, auth, catalog.snapshot, {
          ...params, invocation: context.invocation, traceId: request.requestId, refusalSink: context.refusalSink, note: body.note,
          catalogSnapshots: catalog.snapshots
        });
      } else {
        // Match approval's user-before-request lock order; a simultaneous approve/reject must not deadlock.
        row = await load(tx, auth, params.projectId, params.requestId, true);
        if (!row || row.assigned_to_user_id !== auth.user.id || row.submitter_user_id === auth.user.id
          || row.source_revision_proof_digest !== body.proofDigest) throw new ApiError("CONFLICT", "Source request assignment or proof changed.");
        if (row.status === "rejected" && row.reviewer_user_id === auth.user.id) return dto(row, auth);
        if (row.status !== "pending") throw new ApiError("CONFLICT", "Whole-source request is already closed.");
        await tx.query(`update public.project_parameter_value_change_requests set status='rejected',reviewer_user_id=$4,
          reviewer_note=$5,updated_at=now() where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision' and status='pending'`, [row.id, parameterOrganizationId(auth), params.projectId, auth.user.id, body.note ?? null]);
        await writeTrustedGovernanceAudit(asAuditTx(tx), context.invocation, { action: "value-change-reviewed", organizationId: parameterOrganizationId(auth), projectId: params.projectId, targetType: "project-parameter-value-change-request", targetId: row.id,
          metadata: { requestId: row.id, requestKind: "source_revision", decision: "reject", proofDigest: body.proofDigest } }, request.requestId);
      }
      const updated = await load(tx, auth, params.projectId, params.requestId);
      if (!updated) throw new ApiError("CONFLICT", "Whole-source request receipt is unavailable.");
      return dto(updated, auth);
    });
    return { status: 200, body: { item } };
  });
  router.post(`${path}/:requestId/withdraw`, async (request) => {
    const db = database(), auth = await parameterRequestAccess(options.db, createUserInvocation(await options.getCurrentAuthContext(request)), request);
    const params = parse(paramsSchema, request.params);
    parse(z.object({}).strict(), request.body ?? {});
    const context = security(auth, request);
    await requireCanonicalUserInvocation(auth, context, { projectId: params.projectId, operation: "whole DTS source withdraw", targetType: "project-parameter-value-change-request", targetId: params.requestId });
    await ownedProject(db, auth, params.projectId);
    const item = await db.transaction(async (tx) => {
      const row = await load(tx, auth, params.projectId, params.requestId, true);
      if (!row) throw new ApiError("NOT_FOUND", "Whole-source request was not found.");
      if (row.submitter_user_id !== auth.user.id) {
        await recordCanonicalPermissionRefusal(context, { projectId: params.projectId, operation: "whole DTS source withdraw", targetType: "project-parameter-value-change-request", targetId: row.id, details: { reason: "withdraw-not-submitter" } });
        throw new ApiError("FORBIDDEN", "Only the submitter can withdraw this source request.");
      }
      frozenProof(row, auth);
      if (row.status === "withdrawn") return dto(row, auth);
      if (row.status !== "pending") throw new ApiError("CONFLICT", "Whole-source request is already closed.");
      await tx.query(`update public.project_parameter_value_change_requests set status='withdrawn',reviewer_user_id=$4,
        updated_at=now() where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision' and status='pending'`, [row.id, parameterOrganizationId(auth), params.projectId, auth.user.id]);
      await writeTrustedGovernanceAudit(asAuditTx(tx), context.invocation, { action: "value-change-withdrawn", organizationId: parameterOrganizationId(auth), projectId: params.projectId, targetType: "project-parameter-value-change-request", targetId: row.id,
        metadata: { requestId: row.id, requestKind: "source_revision", proofDigest: row.source_revision_proof_digest } }, request.requestId);
      const updated = await load(tx, auth, params.projectId, params.requestId);
      if (!updated) throw new ApiError("CONFLICT", "Whole-source request receipt is unavailable.");
      return dto(updated, auth);
    });
    return { status: 200, body: { item } };
  });
}
