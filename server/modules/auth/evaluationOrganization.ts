import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export const EVALUATION_ORGANIZATION_ID = "org-chargelab";
export const DEFAULT_BOOTSTRAP_ORGANIZATION_NAME = "WiseEff";
export const RETIRED_DEPARTMENT_ORGANIZATION_IDS = ["org-hardware-department", "org-software-department"] as const;
export const RETIRED_DEPARTMENT_ORGANIZATION_NAMES = new Set(["硬件部", "软件部"]);

export type ResolvedOrganization = {
  id: string;
  name: string;
};

type OrganizationRow = {
  id: string;
  name: string;
};

export function isRetiredDepartmentOrganizationId(organizationId: string) {
  return (RETIRED_DEPARTMENT_ORGANIZATION_IDS as readonly string[]).includes(organizationId);
}

export function isRetiredDepartmentOrganizationName(organizationName: string) {
  return RETIRED_DEPARTMENT_ORGANIZATION_NAMES.has(organizationName.trim());
}

export async function findOrganizationById(db: Queryable, organizationId: string) {
  const result = await db.query<OrganizationRow>(
    `
    select id, name
    from organizations
    where id = $1
    limit 1
    `,
    [organizationId]
  );
  return result.rows[0] ?? null;
}

export async function listJoinableOrganizations(db: Queryable) {
  const result = await db.query<OrganizationRow>(
    `
    select id, name
    from organizations
    where id <> all($1::text[])
    order by created_at asc, id asc
    `,
    [RETIRED_DEPARTMENT_ORGANIZATION_IDS]
  );
  return result.rows;
}

export async function resolveEvaluationOrganization(db: Queryable): Promise<ResolvedOrganization> {
  const evaluation = await findOrganizationById(db, EVALUATION_ORGANIZATION_ID);
  if (evaluation) {
    return evaluation;
  }

  const joinable = await listJoinableOrganizations(db);
  if (joinable.length === 1) {
    return joinable[0];
  }

  throw new ApiError(
    "VALIDATION_FAILED",
    joinable.length === 0
      ? "Evaluation Organization is not available. Bootstrap a local admin first."
      : "Evaluation Organization is ambiguous. Bootstrap or seed exactly one Organization.",
    { organizationCount: joinable.length }
  );
}

export async function resolveBootstrapOrganization(
  db: Queryable,
  input: { organizationName?: string } = {}
): Promise<ResolvedOrganization & { created: boolean }> {
  const evaluation = await findOrganizationById(db, EVALUATION_ORGANIZATION_ID);
  if (evaluation) {
    return { ...evaluation, created: false };
  }

  const explicitName = input.organizationName?.trim() ?? "";
  if (explicitName && isRetiredDepartmentOrganizationName(explicitName)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Hardware Department and Software Department are not Organizations.",
      { organization: explicitName }
    );
  }

  const joinable = await listJoinableOrganizations(db);
  if (joinable.length === 1) {
    return { ...joinable[0], created: false };
  }

  if (joinable.length > 1) {
    if (!explicitName) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Multiple Organizations exist. Pass an explicit organization name to join one of them.",
        { organizationCount: joinable.length }
      );
    }
    const matches = joinable.filter((organization) => organization.name === explicitName);
    if (matches.length === 1) {
      return { ...matches[0], created: false };
    }
    throw new ApiError(
      "VALIDATION_FAILED",
      "Organization name does not match exactly one existing Organization.",
      { organization: explicitName, organizationCount: joinable.length }
    );
  }

  const name = explicitName || DEFAULT_BOOTSTRAP_ORGANIZATION_NAME;
  return {
    id: `org-${randomUUID()}`,
    name,
    created: true
  };
}
