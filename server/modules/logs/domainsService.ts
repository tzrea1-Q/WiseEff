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
  type LogDomainDto,
  type LogDomainKnowledgeLinkDto,
  type LogDomainStatus
} from "./domainsRepository";
import { validateLogFormatProfile, type LogFormatProfile } from "./formatProfile";
import { requireLogAdminDomains, requireLogView } from "./policy";

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
};

function logDomainAudit(input: {
  kind: "log-domain-create" | "log-domain-update" | "log-domain-archive" | "log-domain-knowledge-links-update";
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
    throw new ApiError("VALIDATION_FAILED", "Log domain format profile is invalid.", 400, { issues: result.issues });
  }
  return result.profile;
}

function trimmedName(name: string) {
  const value = name.trim();
  if (value.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "Log domain name must not be blank.", 400);
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
      throw new ApiError("CONFLICT", "A log domain with this name already exists in the organization.", 409, {
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
      throw new ApiError("NOT_FOUND", "Log domain was not found.", 404, { domainId: input.domainId });
    }
    if (name && name !== existing.name) {
      const conflicting = await findLogDomainByName(tx, { organizationId: auth.organization.id, name });
      if (conflicting && conflicting.id !== input.domainId) {
        throw new ApiError("CONFLICT", "A log domain with this name already exists in the organization.", 409, {
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
      status: input.status
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", 404, { domainId: input.domainId });
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
          formatProfileChanged: input.formatProfile !== undefined
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
      throw new ApiError("NOT_FOUND", "Log domain was not found.", 404, { domainId });
    }

    const domain = await updateLogDomainRow(tx, {
      organizationId: auth.organization.id,
      domainId,
      status: "archived"
    });
    if (!domain) {
      throw new ApiError("NOT_FOUND", "Log domain was not found.", 404, { domainId });
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
    throw new ApiError("NOT_FOUND", "Log domain was not found.", 404, { domainId });
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
      throw new ApiError("NOT_FOUND", "Log domain was not found.", 404, { domainId: input.domainId });
    }

    for (const entryId of knowledgeEntryIds) {
      const entry = await getKnowledgeEntryById(tx, auth, entryId);
      if (!entry) {
        throw new ApiError("NOT_FOUND", "Knowledge entry was not found.", 404, { knowledgeEntryId: entryId });
      }
      if (entry.status !== "published") {
        throw new ApiError("VALIDATION_FAILED", "Only published knowledge entries can be linked to a log domain.", 400, {
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
