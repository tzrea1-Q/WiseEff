import type { Queryable } from "../../shared/database/client";
import type { LogFormatProfile } from "./formatProfile";

export type LogDomainStatus = "active" | "archived";

export type LogDomainDto = {
  id: string;
  name: string;
  description?: string;
  status: LogDomainStatus;
  formatProfile?: LogFormatProfile;
  createdAt: string;
  updatedAt: string;
};

type LogDomainRow = {
  id: string;
  name: string;
  description: string | null;
  status: LogDomainStatus;
  format_profile: LogFormatProfile | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toLogDomainDto(row: LogDomainRow): LogDomainDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    formatProfile: row.format_profile ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

const logDomainSelect = `
  select id, name, description, status, format_profile, created_at, updated_at
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
    returning id, name, description, status, format_profile, created_at, updated_at
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
  }
): Promise<LogDomainDto | null> {
  const result = await db.query<LogDomainRow>(
    `
    update log_domains
    set name = coalesce($3, name),
      description = case when $4 then $5 else description end,
      format_profile = case when $6 then $7::jsonb else format_profile end,
      status = coalesce($8, status),
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning id, name, description, status, format_profile, created_at, updated_at
    `,
    [
      input.organizationId,
      input.domainId,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.formatProfile !== undefined,
      input.formatProfile ? JSON.stringify(input.formatProfile) : null,
      input.status ?? null
    ]
  );

  return result.rows[0] ? toLogDomainDto(result.rows[0]) : null;
}

/** Upload/rerun binding lookup: the domain must belong to the organization and be active. */
export async function getActiveLogDomainForBinding(
  db: Queryable,
  query: { organizationId: string; domainId: string }
): Promise<LogDomainDto | null> {
  const domain = await getLogDomainById(db, query);
  return domain && domain.status === "active" ? domain : null;
}
