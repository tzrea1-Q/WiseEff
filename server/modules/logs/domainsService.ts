import { withKnowledgeInvocation } from "../knowledge/scope";
import { organizationId as logOrganizationId, type LogAccessContext } from "./principal";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { withAuditedWrite, type AuditSpec } from "../audit/auditedWrite";
import type { AuditedWriteContext } from "../audit/auditedWrite";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getEntryById as getKnowledgeEntryById } from "../knowledge/repository";
import { canReadEntry } from "../knowledge/policy";
import {
  findLogDomainByName,
  findLogDomainBySkillKey,
  getLogDomainById,
  insertLogDomain,
  listLogDomainKnowledgeLinks,
  listLogDomains,
  replaceLogDomainKnowledgeLinks,
  updateLogDomainRow,
  updateLogDomainWebhookRow,
  type LogDomainDto,
  type LogDomainKnowledgeLinkDto,
  type LogDomainStatus
} from "./domainsRepository";
import { validateLogFormatProfile, type LogFormatProfile } from "./formatProfile";
import { requireLogAdminDomains, requireLogView } from "./policy";
import { listRecentLogWebhookDeliveries, type LogWebhookDeliveryDto } from "./webhookRepository";
import type { LogWebhookDeliverer, LogWebhookDeliveryOutcome } from "./webhookDelivery";
import { validateWebhookUrl } from "./webhookSecurity";
import { insertSkillRevision, listSkillRevisions, lockSkill } from "./skillsRepository";
import { skillKeySchema } from "./schemas";

export type CreateLogDomainInput = {
  name: string;
  description?: string;
  formatProfile?: unknown;
};

export type UpdateLogDomainInput = {
  domainId: string;
  skillKey?: string;
  name?: string;
  description?: string | null;
  /** undefined = keep; null = clear the stored profile. */
  formatProfile?: unknown;
  status?: LogDomainStatus;
  /** undefined = keep; null = clear back to the global model (P3b). */
  modelOverride?: string | null;
};

function logDomainAudit(input: {
  kind:
    | "log-domain-create"
    | "log-domain-update"
    | "log-domain-archive"
    | "log-domain-knowledge-links-update"
    | "log-domain-webhook-config"
    | "log-domain-webhook-test";
  action: string;
  domainId: string;
  metadata?: Record<string, unknown>;
}): AuditSpec {
  return {
    app: "log-analysis",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    projectId: null,
    targetType: "log-domain",
    targetId: input.domainId,
    metadata: input.metadata ?? {}
  };
}

function parseFormatProfileOrThrow(value: unknown): LogFormatProfile | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const result = validateLogFormatProfile(value);
  if (!result.ok) {
    throw new ApiError("VALIDATION_FAILED", "日志格式配置无效。", { issues: result.issues });
  }
  return result.profile;
}

function trimmedName(name: string) {
  const value = name.trim();
  if (value.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "技能名称不能为空。");
  }
  return value;
}

function skillNameConflict(skill: LogDomainDto) {
  return new ApiError("CONFLICT", `名称「${skill.name}」已被${skill.status === "archived" ? "归档" : "现有"}技能占用，请使用其他名称，或查看该技能。`, {
    name: skill.name, conflictingSkill: { id: skill.id, name: skill.name, status: skill.status }
  });
}

export async function listLogDomainRecords(
  db: Queryable,
  auth: LogAccessContext,
  query: { includeArchived?: boolean } = {}
): Promise<{ items: LogDomainDto[] }> {
  requireLogView(auth);
  return { items: await listLogDomains(db, { organizationId: logOrganizationId(auth), includeArchived: query.includeArchived }) };
}

export async function createLogDomainRecord(
  db: Database,
  auth: LogAccessContext,
  input: CreateLogDomainInput,
  context: AuditedWriteContext
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);
  const name = trimmedName(input.name);
  const formatProfile = parseFormatProfileOrThrow(input.formatProfile);

  return withAuditedWrite(db, (auth.logInvocation ?? createUserInvocation(auth)), context, async (tx) => {
    const existing = await findLogDomainByName(tx, { organizationId: logOrganizationId(auth), name });
    if (existing) {
      throw new ApiError("CONFLICT", "组织内已存在同名技能。", {
        name
      });
    }

    const domain = await insertLogDomain(tx, {
      id: randomUUID(),
      organizationId: logOrganizationId(auth),
      name,
      description: input.description,
      formatProfile
    });
    await insertSkillRevision(tx, { organizationId: logOrganizationId(auth), skillId: domain.id,
      spec: { schemaVersion: "skill/v1", ...(formatProfile ? { formatProfile } : {}) }, userId: auth.user.id, published: true });

    return {
      result: domain,
      audit: logDomainAudit({
        kind: "log-domain-create",
        action: "create",
        domainId: domain.id,
        metadata: { name: domain.name, hasFormatProfile: Boolean(formatProfile) }
      })
    };
  });
}

export async function updateLogDomainRecord(
  db: Database,
  auth: LogAccessContext,
  input: UpdateLogDomainInput,
  context: AuditedWriteContext
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);
  const name = input.name !== undefined ? trimmedName(input.name) : undefined;
  if (input.skillKey !== undefined && !skillKeySchema.safeParse(input.skillKey).success) {
    throw new ApiError("VALIDATION_FAILED", "技能标识格式无效。", { fieldErrors: { skillKey: "请输入 2–63 位小写字母、数字或连字符，并以字母或数字开头。" } });
  }
  const formatProfile =
    input.formatProfile === undefined ? undefined : input.formatProfile === null ? null : parseFormatProfileOrThrow(input.formatProfile);

  return withAuditedWrite(db, (auth.logInvocation ?? createUserInvocation(auth)), context, async (tx) => {
    await lockSkill(tx, logOrganizationId(auth), input.domainId);
    const existing = await getLogDomainById(tx, { organizationId: logOrganizationId(auth), domainId: input.domainId });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId: input.domainId });
    }
    if (input.skillKey !== undefined && input.skillKey !== existing.skillKey) {
      // Serialize key allocation and edits in this organization, including the
      // database creation trigger, before checking the unique constraint.
      await tx.query("select pg_advisory_xact_lock(hashtextextended('log-skill-key:' || $1, 0))", [logOrganizationId(auth)]);
      const conflicting = await findLogDomainBySkillKey(tx, { organizationId: logOrganizationId(auth), skillKey: input.skillKey });
      if (conflicting) throw new ApiError("VALIDATION_FAILED", "组织内已存在相同的技能标识。", {
        fieldErrors: { skillKey: "组织内已存在相同的技能标识。" }
      });
    }
    const revisioned = input.formatProfile !== undefined || input.modelOverride !== undefined || input.description !== undefined;
    const revisions = revisioned ? await listSkillRevisions(tx, logOrganizationId(auth), input.domainId) : [];
    if (revisions.some((revision) => revision.status === "draft")) {
      throw new ApiError("LOG_SKILL_DRAFT_EXISTS", "请先发布或放弃技能草稿。");
    }
    if (name && name !== existing.name) {
      const conflicting = await findLogDomainByName(tx, { organizationId: logOrganizationId(auth), name });
      if (conflicting && conflicting.id !== input.domainId) {
        throw skillNameConflict(conflicting);
      }
    }

    const domain = await updateLogDomainRow(tx, {
      organizationId: logOrganizationId(auth),
      domainId: input.domainId,
      skillKey: input.skillKey,
      name,
      description: input.description,
      formatProfile,
      status: input.status,
      modelOverride: input.modelOverride === undefined ? undefined : input.modelOverride?.trim() || null
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId: input.domainId });
    }

    if (revisioned) {
      const current = revisions.find((r) => r.status === "published")!;
      const spec = { ...current.spec };
      if (input.description !== undefined) spec.description = domain.description ?? "";
      if (input.formatProfile !== undefined) {
        if (formatProfile) spec.formatProfile = formatProfile;
        else delete spec.formatProfile;
      }
      if (input.modelOverride !== undefined) {
        if (domain.modelOverride) spec.modelOverride = domain.modelOverride;
        else delete spec.modelOverride;
      }
      // The compatibility API publishes immediately, only when no authored draft exists.
      await tx.query(`update log_skill_revisions set status = 'superseded'
        where organization_id = $1 and skill_id = $2 and status = 'published'`, [logOrganizationId(auth), domain.id]);
      await insertSkillRevision(tx, { organizationId: logOrganizationId(auth), skillId: domain.id, spec, userId: auth.user.id, published: true });
    }

    return {
      result: domain,
      audit: logDomainAudit({
        kind: "log-domain-update",
        action: "update",
        domainId: domain.id,
        metadata: {
          name: domain.name,
          status: domain.status,
          formatProfileChanged: input.formatProfile !== undefined,
          modelOverrideChanged: input.modelOverride !== undefined,
          modelOverride: domain.modelOverride ?? null,
          ...(input.skillKey !== undefined && input.skillKey !== existing.skillKey ? {
            previousSkillKey: existing.skillKey, skillKey: domain.skillKey
          } : {})
        }
      })
    };
  }).catch(async (cause: unknown) => {
    // A concurrent create/rename can win after the availability check. The
    // failed audited transaction has rolled back before reading its occupier.
    if (cause instanceof pg.DatabaseError && cause.code === "23505" && name) {
      const conflicting = await findLogDomainByName(db, { organizationId: logOrganizationId(auth), name });
      if (conflicting && conflicting.id !== input.domainId) throw skillNameConflict(conflicting);
    }
    throw cause;
  });
}

export async function archiveLogDomainRecord(
  db: Database,
  auth: LogAccessContext,
  domainId: string,
  context: AuditedWriteContext
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);

  return withAuditedWrite(db, (auth.logInvocation ?? createUserInvocation(auth)), context, async (tx) => {
    const existing = await getLogDomainById(tx, { organizationId: logOrganizationId(auth), domainId });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId });
    }

    const domain = await updateLogDomainRow(tx, {
      organizationId: logOrganizationId(auth),
      domainId,
      status: "archived"
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId });
    }

    return {
      result: domain,
      audit: logDomainAudit({
        kind: "log-domain-archive",
        action: "archive",
        domainId,
        metadata: { name: domain.name }
      })
    };
  });
}

export async function listLogDomainKnowledgeLinkRecords(
  db: Queryable,
  auth: LogAccessContext,
  domainId: string
): Promise<{ items: LogDomainKnowledgeLinkDto[] }> {
  requireLogAdminDomains(auth);
  const domain = await getLogDomainById(db, { organizationId: logOrganizationId(auth), domainId });
  if (!domain) {
    throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId });
  }
  return { items: await listLogDomainKnowledgeLinks(db, auth, domainId) };
}

/**
 * Replaces a domain's knowledge-entry link set (P2). Only PUBLISHED entries are
 * linkable — the link set bounds `read_domain_knowledge` retrieval, and publishing
 * stays the single trust gate for anything an agent reads (design D13). Entries
 * archived after linking simply drop out of retrieval; the stale link stays
 * visible to governance.
 */
export async function setLogDomainKnowledgeLinkRecords(
  db: Database,
  auth: LogAccessContext,
  input: { domainId: string; knowledgeEntryIds: string[] },
  context: AuditedWriteContext
): Promise<{ items: LogDomainKnowledgeLinkDto[] }> {
  requireLogAdminDomains(auth);
  const knowledgeEntryIds = [...new Set(input.knowledgeEntryIds)];

  const items = await withAuditedWrite(db, (auth.logInvocation ?? createUserInvocation(auth)), context, async (tx) => {
    await lockSkill(tx, logOrganizationId(auth), input.domainId);
    const revisions = await listSkillRevisions(tx, logOrganizationId(auth), input.domainId);
    if (revisions.some((revision) => revision.status === "draft")) {
      throw new ApiError("LOG_SKILL_DRAFT_EXISTS", "请先发布或放弃技能草稿，再修改关联知识。");
    }
    const domain = await getLogDomainById(tx, { organizationId: logOrganizationId(auth), domainId: input.domainId });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId: input.domainId });
    }

    for (const entryId of knowledgeEntryIds) {
      const entry = await getKnowledgeEntryById(tx, auth.logInvocation ? withKnowledgeInvocation(auth, auth.logInvocation) : auth, entryId);
      if (!entry || (entry.status !== "published" && !canReadEntry(auth, entry))) {
        throw new ApiError("NOT_FOUND", "未找到知识条目。", { knowledgeEntryId: entryId });
      }
      if (entry.status !== "published") {
        throw new ApiError("VALIDATION_FAILED", "只能关联已发布的知识条目。", {
          knowledgeEntryId: entryId,
          status: entry.status
        });
      }
    }

    const current = revisions.find((revision) => revision.status === "published")!;
    const previousIds = current.spec.knowledgeEntryIds ?? [];
    await replaceLogDomainKnowledgeLinks(tx, {
      organizationId: logOrganizationId(auth),
      domainId: input.domainId,
      knowledgeEntryIds,
      createdByUserId: auth.user.id,
      newLinkId: () => randomUUID()
    });

    await tx.query(`update log_skill_revisions set status = 'superseded'
      where organization_id = $1 and skill_id = $2 and status = 'published'`, [logOrganizationId(auth), input.domainId]);
    await insertSkillRevision(tx, { organizationId: logOrganizationId(auth), skillId: input.domainId,
      spec: { ...current.spec, knowledgeEntryIds }, userId: auth.user.id, published: true });

    return {
      result: await listLogDomainKnowledgeLinks(tx, auth, input.domainId),
      audit: logDomainAudit({
        kind: "log-domain-knowledge-links-update",
        action: "update-knowledge-links",
        domainId: input.domainId,
        metadata: {
          name: domain.name,
          linkedCount: knowledgeEntryIds.length,
          addedCount: knowledgeEntryIds.filter((id) => !previousIds.includes(id)).length,
          removedCount: previousIds.filter((id) => !knowledgeEntryIds.includes(id)).length
        }
      })
    };
  });

  return { items };
}

export type SetLogDomainWebhookInput = {
  domainId: string;
  /** null clears the endpoint (and forces enabled=false semantics downstream). */
  url: string | null;
  enabled: boolean;
  /** undefined = keep the stored secret; null = clear it. */
  secret?: string | null;
};

export type LogDomainWebhookSecurityOptions = {
  allowInsecureLocal?: boolean;
};

/**
 * Saves a domain's result-webhook configuration (P3b). The URL passes the same
 * SSRF shape validation the sender applies (https-only, no credentials, no
 * private/loopback/link-local/metadata IP literals — see `webhookSecurity.ts`);
 * hostname DNS answers are enforced at delivery time by the validating lookup,
 * which is the authoritative gate against DNS rebinding. The secret is
 * write-only: responses only carry `secretConfigured` + last four characters.
 */
export async function setLogDomainWebhookRecord(
  db: Database,
  auth: LogAccessContext,
  input: SetLogDomainWebhookInput,
  context: AuditedWriteContext,
  security: LogDomainWebhookSecurityOptions = {}
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);

  const url = input.url?.trim() || null;
  if (url) {
    const validation = validateWebhookUrl(url, { allowInsecureLocal: security.allowInsecureLocal });
    if (!validation.ok) {
      throw new ApiError("VALIDATION_FAILED", validation.message, { reason: validation.reason });
    }
  }
  if (input.enabled && !url) {
    throw new ApiError("VALIDATION_FAILED", "启用结果通知前，请填写接收地址。", { reason: "webhook-url-required" });
  }

  return withAuditedWrite(db, (auth.logInvocation ?? createUserInvocation(auth)), context, async (tx) => {
    const existing = await getLogDomainById(tx, { organizationId: logOrganizationId(auth), domainId: input.domainId });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId: input.domainId });
    }

    const secretAfterUpdate = input.secret === undefined ? existing.webhook.secretConfigured : Boolean(input.secret);
    if (input.enabled && !secretAfterUpdate) {
      throw new ApiError("VALIDATION_FAILED", "启用结果通知前，请设置签名密钥。", {
        reason: "webhook-secret-required"
      });
    }

    const domain = await updateLogDomainWebhookRow(tx, {
      organizationId: logOrganizationId(auth),
      domainId: input.domainId,
      url,
      enabled: input.enabled,
      secret: input.secret
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId: input.domainId });
    }

    return {
      result: domain,
      audit: logDomainAudit({
        kind: "log-domain-webhook-config",
        action: "update-webhook",
        domainId: domain.id,
        metadata: {
          name: domain.name,
          enabled: input.enabled,
          url,
          secretChanged: input.secret !== undefined
        }
      })
    };
  });
}

export async function listLogDomainWebhookDeliveryRecords(
  db: Queryable,
  auth: LogAccessContext,
  input: { domainId: string; limit?: number }
): Promise<{ items: LogWebhookDeliveryDto[] }> {
  requireLogAdminDomains(auth);
  const domain = await getLogDomainById(db, { organizationId: logOrganizationId(auth), domainId: input.domainId });
  if (!domain) {
    throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId: input.domainId });
  }
  return {
    items: await listRecentLogWebhookDeliveries(db, {
      organizationId: logOrganizationId(auth),
      domainId: input.domainId,
      limit: input.limit
    })
  };
}

/**
 * Admin-triggered test delivery: one attempt through the exact same SSRF-guarded
 * sender path, recorded as a kind='test' delivery row and audited with the outcome.
 */
export async function sendLogDomainWebhookTestDelivery(
  db: Database,
  auth: LogAccessContext,
  domainId: string,
  deliverer: Pick<LogWebhookDeliverer, "sendTestDelivery">,
  context: AuditedWriteContext
): Promise<LogWebhookDeliveryOutcome> {
  requireLogAdminDomains(auth);
  const domain = await getLogDomainById(db, { organizationId: logOrganizationId(auth), domainId });
  if (!domain) {
    throw new ApiError("NOT_FOUND", "未找到分析技能。", { domainId });
  }

  const outcome = await deliverer.sendTestDelivery({ organizationId: logOrganizationId(auth), domainId });

  return withAuditedWrite(db, (auth.logInvocation ?? createUserInvocation(auth)), context, async () => ({
    result: outcome,
    audit: logDomainAudit({
      kind: "log-domain-webhook-test",
      action: "send-webhook-test",
      domainId,
      metadata: {
        name: domain.name,
        status: outcome.status,
        attempts: outcome.attempts,
        httpStatus: outcome.httpStatus ?? null,
        error: outcome.error ?? null
      }
    })
  }));
}
