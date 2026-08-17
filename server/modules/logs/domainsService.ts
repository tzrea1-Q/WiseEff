import { randomUUID } from "node:crypto";

import { withAuditedWrite, type AuditSpec } from "../audit/auditedWrite";
import type { AuditedWriteContext } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getEntryById as getKnowledgeEntryById } from "../knowledge/repository";
import {
  findLogDomainByName,
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

export type CreateLogDomainInput = {
  name: string;
  description?: string;
  formatProfile?: unknown;
};

export type UpdateLogDomainInput = {
  domainId: string;
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
    throw new ApiError("VALIDATION_FAILED", "Log domain format profile is invalid.", { issues: result.issues });
  }
  return result.profile;
}

function trimmedName(name: string) {
  const value = name.trim();
  if (value.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "Log domain name must not be blank.");
  }
  return value;
}

export async function listLogDomainRecords(
  db: Queryable,
  auth: AuthContext,
  query: { includeArchived?: boolean } = {}
): Promise<{ items: LogDomainDto[] }> {
  requireLogView(auth);
  return { items: await listLogDomains(db, { organizationId: auth.organization.id, includeArchived: query.includeArchived }) };
}

export async function createLogDomainRecord(
  db: Database,
  auth: AuthContext,
  input: CreateLogDomainInput,
  context: AuditedWriteContext
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);
  const name = trimmedName(input.name);
  const formatProfile = parseFormatProfileOrThrow(input.formatProfile);

  return withAuditedWrite(db, auth, context, async (tx) => {
    const existing = await findLogDomainByName(tx, { organizationId: auth.organization.id, name });
    if (existing) {
      throw new ApiError("CONFLICT", "A log domain with this name already exists in the organization.", {
        name
      });
    }

    const domain = await insertLogDomain(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      name,
      description: input.description,
      formatProfile
    });

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
  auth: AuthContext,
  input: UpdateLogDomainInput,
  context: AuditedWriteContext
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);
  const name = input.name !== undefined ? trimmedName(input.name) : undefined;
  const formatProfile =
    input.formatProfile === undefined ? undefined : input.formatProfile === null ? null : parseFormatProfileOrThrow(input.formatProfile);

  return withAuditedWrite(db, auth, context, async (tx) => {
    const existing = await getLogDomainById(tx, { organizationId: auth.organization.id, domainId: input.domainId });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId: input.domainId });
    }
    if (name && name !== existing.name) {
      const conflicting = await findLogDomainByName(tx, { organizationId: auth.organization.id, name });
      if (conflicting && conflicting.id !== input.domainId) {
        throw new ApiError("CONFLICT", "A log domain with this name already exists in the organization.", {
          name
        });
      }
    }

    const domain = await updateLogDomainRow(tx, {
      organizationId: auth.organization.id,
      domainId: input.domainId,
      name,
      description: input.description,
      formatProfile,
      status: input.status,
      modelOverride: input.modelOverride === undefined ? undefined : input.modelOverride?.trim() || null
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId: input.domainId });
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
          modelOverride: domain.modelOverride ?? null
        }
      })
    };
  });
}

export async function archiveLogDomainRecord(
  db: Database,
  auth: AuthContext,
  domainId: string,
  context: AuditedWriteContext
): Promise<LogDomainDto> {
  requireLogAdminDomains(auth);

  return withAuditedWrite(db, auth, context, async (tx) => {
    const existing = await getLogDomainById(tx, { organizationId: auth.organization.id, domainId });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId });
    }

    const domain = await updateLogDomainRow(tx, {
      organizationId: auth.organization.id,
      domainId,
      status: "archived"
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId });
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
  auth: AuthContext,
  domainId: string
): Promise<{ items: LogDomainKnowledgeLinkDto[] }> {
  requireLogAdminDomains(auth);
  const domain = await getLogDomainById(db, { organizationId: auth.organization.id, domainId });
  if (!domain) {
    throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId });
  }
  return { items: await listLogDomainKnowledgeLinks(db, { organizationId: auth.organization.id, domainId }) };
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
  auth: AuthContext,
  input: { domainId: string; knowledgeEntryIds: string[] },
  context: AuditedWriteContext
): Promise<{ items: LogDomainKnowledgeLinkDto[] }> {
  requireLogAdminDomains(auth);
  const knowledgeEntryIds = [...new Set(input.knowledgeEntryIds)];

  const items = await withAuditedWrite(db, auth, context, async (tx) => {
    const domain = await getLogDomainById(tx, { organizationId: auth.organization.id, domainId: input.domainId });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId: input.domainId });
    }

    for (const entryId of knowledgeEntryIds) {
      const entry = await getKnowledgeEntryById(tx, auth, entryId);
      if (!entry) {
        throw new ApiError("NOT_FOUND", "Knowledge entry was not found.", { knowledgeEntryId: entryId });
      }
      if (entry.status !== "published") {
        throw new ApiError("VALIDATION_FAILED", "Only published knowledge entries can be linked to a log domain.", {
          knowledgeEntryId: entryId,
          status: entry.status
        });
      }
    }

    const { added, removed } = await replaceLogDomainKnowledgeLinks(tx, {
      organizationId: auth.organization.id,
      domainId: input.domainId,
      knowledgeEntryIds,
      createdByUserId: auth.user.id,
      newLinkId: () => randomUUID()
    });

    return {
      result: await listLogDomainKnowledgeLinks(tx, { organizationId: auth.organization.id, domainId: input.domainId }),
      audit: logDomainAudit({
        kind: "log-domain-knowledge-links-update",
        action: "update-knowledge-links",
        domainId: input.domainId,
        metadata: {
          name: domain.name,
          linkedCount: knowledgeEntryIds.length,
          addedCount: added.length,
          removedCount: removed.length
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
  auth: AuthContext,
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
    throw new ApiError("VALIDATION_FAILED", "An enabled webhook needs a URL.", { reason: "webhook-url-required" });
  }

  return withAuditedWrite(db, auth, context, async (tx) => {
    const existing = await getLogDomainById(tx, { organizationId: auth.organization.id, domainId: input.domainId });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId: input.domainId });
    }

    const secretAfterUpdate = input.secret === undefined ? existing.webhook.secretConfigured : Boolean(input.secret);
    if (input.enabled && !secretAfterUpdate) {
      throw new ApiError("VALIDATION_FAILED", "An enabled webhook needs a signing secret.", {
        reason: "webhook-secret-required"
      });
    }

    const domain = await updateLogDomainWebhookRow(tx, {
      organizationId: auth.organization.id,
      domainId: input.domainId,
      url,
      enabled: input.enabled,
      secret: input.secret
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId: input.domainId });
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
  auth: AuthContext,
  input: { domainId: string; limit?: number }
): Promise<{ items: LogWebhookDeliveryDto[] }> {
  requireLogAdminDomains(auth);
  const domain = await getLogDomainById(db, { organizationId: auth.organization.id, domainId: input.domainId });
  if (!domain) {
    throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId: input.domainId });
  }
  return {
    items: await listRecentLogWebhookDeliveries(db, {
      organizationId: auth.organization.id,
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
  auth: AuthContext,
  domainId: string,
  deliverer: Pick<LogWebhookDeliverer, "sendTestDelivery">,
  context: AuditedWriteContext
): Promise<LogWebhookDeliveryOutcome> {
  requireLogAdminDomains(auth);
  const domain = await getLogDomainById(db, { organizationId: auth.organization.id, domainId });
  if (!domain) {
    throw new ApiError("NOT_FOUND", "Log domain was not found.", { domainId });
  }

  const outcome = await deliverer.sendTestDelivery({ organizationId: auth.organization.id, domainId });

  return withAuditedWrite(db, auth, context, async () => ({
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
