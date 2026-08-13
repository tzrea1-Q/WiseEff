import type { Queryable } from "../../shared/database/client";
import type { LogFormatProfile } from "./formatProfile";

export type LogDomainStatus = "active" | "archived";

/**
 * Public webhook summary (P3b): the signing secret is write-only — the DTO only
 * says whether one is configured and its last four characters for recognition.
 */
export type LogDomainWebhookSummary = {
  enabled: boolean;
  url?: string;
  secretConfigured: boolean;
  secretLastFour?: string;
};

export type LogDomainDto = {
  id: string;
  name: string;
  description?: string;
  status: LogDomainStatus;
  formatProfile?: LogFormatProfile;
  /** Per-domain model-name override; endpoint/key/budget stay global (P3b). */
  modelOverride?: string;
  webhook: LogDomainWebhookSummary;
  createdAt: string;
  updatedAt: string;
};

type LogDomainRow = {
  id: string;
  name: string;
  description: string | null;
  status: LogDomainStatus;
  format_profile: LogFormatProfile | null;
  model_override: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_enabled: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toWebhookSummary(row: Pick<LogDomainRow, "webhook_url" | "webhook_secret" | "webhook_enabled">): LogDomainWebhookSummary {
  const secret = row.webhook_secret ?? undefined;
  return {
    enabled: row.webhook_enabled,
    url: row.webhook_url ?? undefined,
    secretConfigured: Boolean(secret),
    secretLastFour: secret ? secret.slice(-4) : undefined
  };
}

function toLogDomainDto(row: LogDomainRow): LogDomainDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    formatProfile: row.format_profile ?? undefined,
    modelOverride: row.model_override ?? undefined,
    webhook: toWebhookSummary(row),
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

const logDomainSelect = `
  select id, name, description, status, format_profile, model_override,
    webhook_url, webhook_secret, webhook_enabled, created_at, updated_at
  from log_domains
`;

export async function listLogDomains(
  db: Queryable,
  query: { organizationId: string; includeArchived?: boolean }
): Promise<LogDomainDto[]> {
  const values: unknown[] = [query.organizationId];
  const where = ["organization_id = $1"];
  if (!query.includeArchived) {
    where.push("status = 'active'");
  }

  const result = await db.query<LogDomainRow>(
    `
    ${logDomainSelect}
    where ${where.join("\n      and ")}
    order by name asc, id asc
    `,
    values
  );

  return result.rows.map(toLogDomainDto);
}

export async function getLogDomainById(
  db: Queryable,
  query: { organizationId: string; domainId: string }
): Promise<LogDomainDto | null> {
  const result = await db.query<LogDomainRow>(
    `
    ${logDomainSelect}
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.domainId]
  );

  return result.rows[0] ? toLogDomainDto(result.rows[0]) : null;
}

export async function findLogDomainByName(
  db: Queryable,
  query: { organizationId: string; name: string }
): Promise<LogDomainDto | null> {
  const result = await db.query<LogDomainRow>(
    `
    ${logDomainSelect}
    where organization_id = $1
      and name = $2
    limit 1
    `,
    [query.organizationId, query.name]
  );

  return result.rows[0] ? toLogDomainDto(result.rows[0]) : null;
}

export async function insertLogDomain(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    name: string;
    description?: string;
    formatProfile?: LogFormatProfile;
  }
): Promise<LogDomainDto> {
  const result = await db.query<LogDomainRow>(
    `
    insert into log_domains (id, organization_id, name, description, status, format_profile)
    values ($1, $2, $3, $4, 'active', $5::jsonb)
    returning id, name, description, status, format_profile, model_override,
      webhook_url, webhook_secret, webhook_enabled, created_at, updated_at
    `,
    [input.id, input.organizationId, input.name, input.description ?? null, input.formatProfile ? JSON.stringify(input.formatProfile) : null]
  );

  return toLogDomainDto(result.rows[0]);
}

export async function updateLogDomainRow(
  db: Queryable,
  input: {
    organizationId: string;
    domainId: string;
    name?: string;
    description?: string | null;
    /** undefined = keep; null = clear the stored profile. */
    formatProfile?: LogFormatProfile | null;
    status?: LogDomainStatus;
    /** undefined = keep; null = clear the override (use the global model). */
    modelOverride?: string | null;
  }
): Promise<LogDomainDto | null> {
  const result = await db.query<LogDomainRow>(
    `
    update log_domains
    set name = coalesce($3, name),
      description = case when $4 then $5 else description end,
      format_profile = case when $6 then $7::jsonb else format_profile end,
      status = coalesce($8, status),
      model_override = case when $9 then $10 else model_override end,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning id, name, description, status, format_profile, model_override,
      webhook_url, webhook_secret, webhook_enabled, created_at, updated_at
    `,
    [
      input.organizationId,
      input.domainId,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.formatProfile !== undefined,
      input.formatProfile ? JSON.stringify(input.formatProfile) : null,
      input.status ?? null,
      input.modelOverride !== undefined,
      input.modelOverride ?? null
    ]
  );

  return result.rows[0] ? toLogDomainDto(result.rows[0]) : null;
}

/**
 * Writes the webhook configuration (P3b). `secret` undefined keeps the stored
 * secret (so admins can toggle enabled/url without re-entering it); null clears it.
 */
export async function updateLogDomainWebhookRow(
  db: Queryable,
  input: {
    organizationId: string;
    domainId: string;
    url: string | null;
    enabled: boolean;
    secret?: string | null;
  }
): Promise<LogDomainDto | null> {
  const result = await db.query<LogDomainRow>(
    `
    update log_domains
    set webhook_url = $3,
      webhook_enabled = $4,
      webhook_secret = case when $5 then $6 else webhook_secret end,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning id, name, description, status, format_profile, model_override,
      webhook_url, webhook_secret, webhook_enabled, created_at, updated_at
    `,
    [input.organizationId, input.domainId, input.url, input.enabled, input.secret !== undefined, input.secret ?? null]
  );

  return result.rows[0] ? toLogDomainDto(result.rows[0]) : null;
}

/** Delivery-time lookup: raw webhook config (including the secret) for the sender only. */
export async function getLogDomainWebhookConfig(
  db: Queryable,
  query: { organizationId: string; domainId: string }
): Promise<{ url: string | null; secret: string | null; enabled: boolean; domainName: string } | null> {
  const result = await db.query<{ webhook_url: string | null; webhook_secret: string | null; webhook_enabled: boolean; name: string }>(
    `
    select webhook_url, webhook_secret, webhook_enabled, name
    from log_domains
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.domainId]
  );
  const row = result.rows[0];
  return row ? { url: row.webhook_url, secret: row.webhook_secret, enabled: row.webhook_enabled, domainName: row.name } : null;
}

/** Upload/rerun binding lookup: the domain must belong to the organization and be active. */
export async function getActiveLogDomainForBinding(
  db: Queryable,
  query: { organizationId: string; domainId: string }
): Promise<LogDomainDto | null> {
  const domain = await getLogDomainById(db, query);
  return domain && domain.status === "active" ? domain : null;
}

/**
 * A log domain's link to a published knowledge entry (P2). The link carries the
 * current entry status so governance can spot entries that were archived after
 * linking — retrieval itself stays published-only regardless of stale links.
 */
export type LogDomainKnowledgeLinkDto = {
  id: string;
  logDomainId: string;
  knowledgeEntryId: string;
  entryTitle: string;
  entryStatus: "draft" | "published" | "archived";
  entryTags: string[];
  linkedAt: string;
};

type LogDomainKnowledgeLinkRow = {
  id: string;
  log_domain_id: string;
  knowledge_entry_id: string;
  entry_title: string;
  entry_status: "draft" | "published" | "archived";
  entry_tags: string[];
  created_at: string | Date;
};

function toLogDomainKnowledgeLinkDto(row: LogDomainKnowledgeLinkRow): LogDomainKnowledgeLinkDto {
  return {
    id: row.id,
    logDomainId: row.log_domain_id,
    knowledgeEntryId: row.knowledge_entry_id,
    entryTitle: row.entry_title,
    entryStatus: row.entry_status,
    entryTags: row.entry_tags ?? [],
    linkedAt: dateTimeToIso(row.created_at)
  };
}

export async function listLogDomainKnowledgeLinks(
  db: Queryable,
  query: { organizationId: string; domainId: string }
): Promise<LogDomainKnowledgeLinkDto[]> {
  const result = await db.query<LogDomainKnowledgeLinkRow>(
    `
    select
      link.id,
      link.log_domain_id,
      link.knowledge_entry_id::text as knowledge_entry_id,
      entry.title as entry_title,
      entry.status as entry_status,
      entry.tags as entry_tags,
      link.created_at
    from log_domain_knowledge_links link
    inner join knowledge_entries entry
      on entry.id = link.knowledge_entry_id
      and entry.organization_id = link.organization_id
    where link.organization_id = $1
      and link.log_domain_id = $2
    order by entry.title asc, link.id asc
    `,
    [query.organizationId, query.domainId]
  );

  return result.rows.map(toLogDomainKnowledgeLinkDto);
}

/** Worker-side lookup: the linked entry ids that bound `read_domain_knowledge` retrieval. */
export async function listLogDomainKnowledgeLinkEntryIds(
  db: Queryable,
  query: { organizationId: string; domainId: string }
): Promise<string[]> {
  const result = await db.query<{ knowledge_entry_id: string }>(
    `
    select knowledge_entry_id::text as knowledge_entry_id
    from log_domain_knowledge_links
    where organization_id = $1
      and log_domain_id = $2
    order by created_at asc, id asc
    `,
    [query.organizationId, query.domainId]
  );

  return result.rows.map((row) => row.knowledge_entry_id);
}

/** Replaces the domain's link set; returns what changed for the audit metadata. */
export async function replaceLogDomainKnowledgeLinks(
  db: Queryable,
  input: {
    organizationId: string;
    domainId: string;
    knowledgeEntryIds: string[];
    createdByUserId: string;
    newLinkId: () => string;
  }
): Promise<{ added: string[]; removed: string[] }> {
  const existing = await listLogDomainKnowledgeLinkEntryIds(db, {
    organizationId: input.organizationId,
    domainId: input.domainId
  });
  const nextSet = new Set(input.knowledgeEntryIds);
  const existingSet = new Set(existing);
  const added = input.knowledgeEntryIds.filter((entryId) => !existingSet.has(entryId));
  const removed = existing.filter((entryId) => !nextSet.has(entryId));

  if (removed.length > 0) {
    await db.query(
      `
      delete from log_domain_knowledge_links
      where organization_id = $1
        and log_domain_id = $2
        and knowledge_entry_id = any($3::uuid[])
      `,
      [input.organizationId, input.domainId, removed]
    );
  }
  for (const entryId of added) {
    await db.query(
      `
      insert into log_domain_knowledge_links (id, organization_id, log_domain_id, knowledge_entry_id, created_by_user_id)
      values ($1, $2, $3, $4::uuid, $5)
      `,
      [input.newLinkId(), input.organizationId, input.domainId, entryId, input.createdByUserId]
    );
  }

  return { added, removed };
}
