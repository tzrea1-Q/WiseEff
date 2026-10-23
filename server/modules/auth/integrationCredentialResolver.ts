import { createHash, timingSafeEqual } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { HttpMethod } from "../../shared/http/router";
import type { IntegrationPrincipal } from "./integrationPrincipal";
import { createIntegrationInvocation } from "./trustedInvocation";
import { requireActiveOrganization } from "./organizationLifecycle";

export function isIntegrationAuthorization(authorization: string | string[] | undefined): boolean {
  const values = Array.isArray(authorization) ? authorization : [authorization];
  return values.some((value) => typeof value === "string" && /^Bearer\s+wie_/i.test(value));
}

/** Match registered templates, not raw paths: static siblings must never inherit access. */
export function allowsIntegrationPrincipal(method: HttpMethod, pattern: string | undefined): boolean {
  return method === "POST" && (pattern === "/api/v1/log-files" || pattern === "/api/v1/logs")
    || method === "GET" && (pattern === "/api/v1/logs/:logId" || pattern === "/api/v1/logs/:logId/lines");
}

export function hashIntegrationSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function matchesIntegrationSecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashIntegrationSecret(secret), "hex");
  // Compare equal-length digests even when the stored value is corrupt.
  const validHash = /^[0-9a-f]{64}$/.test(expectedHash);
  const expected = Buffer.from(validHash ? expectedHash : "0".repeat(64), "hex");
  return timingSafeEqual(actual, expected) && validHash;
}

type CredentialRow = {
  id: string; organization_id: string; name: string; skill_id: string | null;
  secret_hash: string; status: string; last_used_at: Date | string | null;
};

export async function resolveIntegrationCredential(db: Queryable, authorization: string | string[] | undefined): Promise<IntegrationPrincipal> {
  const match = typeof authorization === "string"
    ? /^Bearer (wie_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43}))$/i.exec(authorization)
    : null;
  if (!match) throw new ApiError("UNAUTHENTICATED", "Invalid integration credential.");
  const row = (await db.query<CredentialRow>(`select c.id, c.organization_id, c.name, c.skill_id, c.secret_hash, c.status, c.last_used_at
    from log_integration_credentials c left join log_domains s on s.id=c.skill_id and s.organization_id=c.organization_id
    where c.id=$1 and (c.skill_id is null or s.status='active')`, [match[2]])).rows[0];
  // Unknown credentials take the same fixed-length digest comparison path.
  const secretMatches = matchesIntegrationSecret(match[3], row?.secret_hash ?? "0".repeat(64));
  if (!row || !secretMatches || row.status !== "active") throw new ApiError("UNAUTHENTICATED", "Invalid integration credential.");
  await requireActiveOrganization(db, row.organization_id);
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() >= 60_000) {
    await db.query(`update log_integration_credentials set last_used_at=clock_timestamp()
      where id=$1 and organization_id=$2 and status='active'
        and (last_used_at is null or last_used_at <= clock_timestamp() - interval '1 minute')`, [row.id, row.organization_id]);
  }
  return Object.freeze({ kind: "integration", credentialId: row.id, organizationId: row.organization_id,
    name: row.name, skillId: row.skill_id, invocation: createIntegrationInvocation(row.id, row.organization_id) });
}
