import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { requireKnowledgeEdit, canReadEntry } from "../knowledge/policy";
import { createKnowledgeEntry } from "../knowledge/service";
import { createDefaultKnowledgeTextExtractor } from "../knowledge/extraction";
import { findLogDomainByName, findLogDomainBySkillKey, getLogDomainById, insertLogDomain, updateLogDomainRow } from "./domainsRepository";
import { requireLogAdminDomains } from "./policy";
import { readSkill } from "./skillsService";
import { insertSkillRevision, listSkillRevisions } from "./skillsRepository";
import { defaultLogSkillBudgetCaps, validateLogSkillBudgets, type LogSkillBudgetCaps } from "./skillBudgets";
import { importArchivedSkillAnalysisCases, exportSkillAnalysisCases, readAnalysisCases } from "./analysisCases";
import { AnalysisCaseArchiveError, readBoundedZipArchive } from "./analysisCaseArchive";
import { exportSkillPackageArchive, importSkillPackageArchive, type PackagedKnowledge } from "./skillPackageArchive";
import type { ObjectStore } from "./objectStore";

function requireAdmin(auth: AuthContext) {
  requireLogAdminDomains(auth);
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "Log organization access is required.");
}
function archiveError(error: unknown): never {
  if (error instanceof AnalysisCaseArchiveError) throw new ApiError("VALIDATION_FAILED", "Invalid skill package.", { problems: error.problems });
  throw error;
}

export async function exportLogSkillPackage(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, revision: "published" | "draft" = "published") {
  requireAdmin(auth);
  // One database snapshot keeps the selected revision, knowledge heads and cases coherent.
  return db.transaction(async (tx) => {
    await tx.query("set transaction isolation level repeatable read");
    const skill = await getLogDomainById(tx, { organizationId: auth.organization.id, domainId: skillId });
    if (!skill) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
    const selected = (await listSkillRevisions(tx, auth.organization.id, skillId)).find((item) => item.status === revision);
    if (!selected) throw new ApiError("NOT_FOUND", "The requested skill revision was not found.");
    const ids = selected.spec.knowledgeEntryIds ?? [];
    const entries = (await tx.query<{ id: string; title: string; tags: string[]; status: "draft" | "published" | "archived";
      createdByUserId: string | null; sourceType: "human" | "agent"; revisionId: string; revisionNumber: number; body: string | null }>(
      `select e.id, r.title, r.tags, e.status, e.created_by_user_id as "createdByUserId", e.source_type as "sourceType",
        r.id as "revisionId", r.revision_number as "revisionNumber", coalesce(r.content_markdown, f.extracted_text) as body
       from knowledge_entries e join knowledge_revisions r on r.id=e.head_revision_id and r.organization_id=e.organization_id
       left join knowledge_files f on f.id=r.file_id and f.organization_id=r.organization_id
       where e.organization_id=$1 and e.id=any($2::uuid[]) order by e.id`, [auth.organization.id, ids])).rows;
    const knowledge: PackagedKnowledge[] = [];
    for (const id of ids) {
      const entry = entries.find((item) => item.id === id);
      if (!entry || !canReadEntry(auth, entry)) throw new ApiError("NOT_FOUND", "Linked knowledge entry was not found or is not readable.");
      if (entry.body === null) throw new ApiError("CONFLICT", "Linked knowledge text is not available for export.");
      knowledge.push({ path: `knowledge/${entry.id}.md`, title: entry.title, tags: entry.tags, body: entry.body,
        source: { type: entry.sourceType, entryId: entry.id, revisionId: entry.revisionId, revisionNumber: entry.revisionNumber } });
    }
    const cases = (await readAnalysisCases(tx, auth.organization.id, skillId)).length
      ? await readBoundedZipArchive(await exportSkillAnalysisCases(tx, store, auth, skillId)) : new Map<string, Buffer>();
    try { return await exportSkillPackageArchive(skill.name, skill.skillKey, selected.spec, knowledge, cases); }
    catch (error) { return archiveError(error); }
  });
}

export async function importLogSkillPackage(db: Database, store: ObjectStore, auth: AuthContext, bytes: Buffer,
  status: "draft" | "published" = "draft", invocation: TrustedInvocationContext, context: AuditedWriteContext, caps: LogSkillBudgetCaps = defaultLogSkillBudgetCaps) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Import skill package");
  requireAdmin(auth);
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "Skill package import must be initiated by a human.");
  if (status !== "draft" && status !== "published") throw new ApiError("VALIDATION_FAILED", "Invalid import status.");
  const pkg = await importSkillPackageArchive(bytes).catch(archiveError);
  if (pkg.knowledge.length) requireKnowledgeEdit(auth);
  try { validateLogSkillBudgets(pkg.spec, caps); }
  catch (error) {
    if (error instanceof ApiError) throw new ApiError("VALIDATION_FAILED", "Invalid skill package budgets.", {
      problems: ((error.details?.issues ?? []) as Array<{ path: string[]; message: string }>).map((issue) => `SKILL.md: ${issue.path.join(".")}: ${issue.message}`)
    });
    throw error;
  }
  const written: string[] = [];
  const trackingStore: ObjectStore = { ...store, put: async (input) => {
    const object = await store.put(input); written.push(object.storageKey); return object;
  } };
  let rollbackConfirmed = false;
  try {
    return await db.transaction((transaction) => withAuditedWrite(transaction, invocation, context, async (tx) => {
      if (await findLogDomainByName(tx, { organizationId: auth.organization.id, name: pkg.name })) {
        throw new ApiError("CONFLICT", "An analysis skill with this name already exists.");
      }
      const skill = await insertLogDomain(tx, { id: randomUUID(), organizationId: auth.organization.id, name: pkg.name,
        description: pkg.spec.description, formatProfile: pkg.spec.formatProfile });
      if (pkg.skillKey && !await findLogDomainBySkillKey(tx, { organizationId: auth.organization.id, skillKey: pkg.skillKey })) {
        await updateLogDomainRow(tx, { organizationId: auth.organization.id, domainId: skill.id, skillKey: pkg.skillKey });
      }
      if (pkg.spec.modelOverride) await updateLogDomainRow(tx, { organizationId: auth.organization.id, domainId: skill.id, modelOverride: pkg.spec.modelOverride });
      const knowledgeEntryIds: string[] = [];
      for (const entry of pkg.knowledge) {
        const created = await createKnowledgeEntry(tx, trackingStore, createDefaultKnowledgeTextExtractor(), auth,
          { title: entry.title, contentForm: "markdown", tags: entry.tags, contentMarkdown: entry.body }, context);
        knowledgeEntryIds.push(created.id);
      }
      await insertSkillRevision(tx, { organizationId: auth.organization.id, skillId: skill.id,
        spec: { ...pkg.spec, knowledgeEntryIds }, userId: auth.user.id, published: status === "published" });
      if (pkg.cases.length) await importArchivedSkillAnalysisCases(tx, trackingStore, auth, skill.id, pkg.cases, invocation, context);
      return { result: await readSkill(tx, auth.organization.id, skill.id, caps), audit: {
        app: "log-analysis", kind: "log-skill-package-import", action: "log-skill-package-import", severity: "Medium", projectId: null,
        targetType: "log-skill", targetId: skill.id, metadata: { status, knowledgeEntryIds,
          knowledgeSources: pkg.knowledge.map(({ path, source }) => ({ path, source })), caseCount: pkg.cases.length }
      } };
    }), { onConfirmedRollback: () => { rollbackConfirmed = true; } });
  } catch (error) {
    if (rollbackConfirmed) await Promise.all(written.map((key) => store.delete?.(key).catch(() => undefined)));
    throw error;
  }
}
