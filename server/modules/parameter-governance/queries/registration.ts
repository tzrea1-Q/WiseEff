import {
  CatalogSubjectId,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import { assertOrgScope, fail, isUsableToken, runQuery } from "./client";
import { emptyReasonForView, mapRegistrationMethod, mapRegistrationStatus } from "./mapping";
import { loadReviewCountsBySubject } from "./reviewCounts";
import { expandDefinitionSelection, selectSubjectIdsFromRows } from "./selection";
import type {
  CatalogRegistrationProjection,
  DefinitionIdSelection,
  DefinitionSelectionQuery,
  GetPlacementQuery,
  GetRegistrationQuery,
  GovernancePlacementRecord,
  GovernanceQueryable,
  GovernanceQueryFailure,
  GovernanceRegistrationRecord,
  ListRegistrationsQuery,
  ProjectRegistrationsQuery,
  RegistrationList,
  RegistrationProjectionPage,
  RegistrationSelectionQuery,
  Result,
  SubjectIdSelection,
} from "./types";
import { GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "./types";

type RegistrationJoinRow = {
  id: string;
  organization_id: string;
  subject_id: string;
  status: string;
  registration_method: string;
  current_placement_id: string;
  updated_at: Date | string;
  placement_id: string | null;
  module_id: string | null;
  module_name: string | null;
  parent_placement_id: string | null;
};

const LIST_LIMIT_MAX = 100;
const LIST_LIMIT_DEFAULT = 50;

const registrationSelect = `
  select
    registration.id,
    registration.organization_id,
    registration.subject_id,
    registration.status,
    registration.registration_method,
    registration.current_placement_id,
    registration.updated_at,
    placement.id as placement_id,
    placement.module_id,
    module.name as module_name,
    parent_placement.id as parent_placement_id
  from parameter_catalog.organization_subject_registrations registration
  left join parameter_catalog.subject_placements placement
    on placement.id = registration.current_placement_id
   and placement.organization_id = registration.organization_id
  left join public.parameter_modules module
    on module.id = placement.module_id
   and module.organization_id = placement.organization_id
  left join parameter_catalog.subject_placements parent_placement
    on parent_placement.module_id = module.parent_id
   and parent_placement.organization_id = registration.organization_id
`;

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapPlacement = (
  row: RegistrationJoinRow,
): Result<GovernancePlacementRecord, GovernanceQueryFailure> => {
  if (!row.placement_id || !row.module_name) {
    return fail({
      kind: "missing-required-placement",
      registrationId: row.id,
      subjectId: row.subject_id,
    });
  }
  return {
    ok: true,
    value: {
      id: row.placement_id,
      displayName: row.module_name,
      parentPlacementId: row.parent_placement_id,
    },
  };
};

const mapRecord = (
  row: RegistrationJoinRow,
  observedCatalogReleaseId: string,
): Result<GovernanceRegistrationRecord, GovernanceQueryFailure> => {
  const status = mapRegistrationStatus(row.status);
  const method = mapRegistrationMethod(row.registration_method);
  if (!status || !method) {
    return fail({ kind: "invalid-query", reason: "registration-literal" });
  }
  const placement = mapPlacement(row);
  if (!placement.ok) {
    return placement;
  }
  return {
    ok: true,
    value: {
      id: row.id,
      organizationId: row.organization_id,
      subjectId: CatalogSubjectId(row.subject_id),
      status,
      method,
      placement: placement.value,
      catalogReleaseId: observedCatalogReleaseId,
      etag: `${row.id}:${status}:${toIso(row.updated_at)}`,
    },
  };
};

const mapProjection = (
  row: RegistrationJoinRow,
): Result<CatalogRegistrationProjection, GovernanceQueryFailure> => {
  const status = mapRegistrationStatus(row.status);
  const method = mapRegistrationMethod(row.registration_method);
  if (!status || !method) {
    return fail({ kind: "invalid-query", reason: "registration-literal" });
  }
  const placement = mapPlacement(row);
  if (!placement.ok) {
    return placement;
  }
  return {
    ok: true,
    value: {
      status,
      id: row.id,
      method,
      placement: placement.value,
    },
  };
};

const loadRowsForSubjects = async (
  client: GovernanceQueryable,
  organizationId: string,
  subjectIds: readonly string[],
): Promise<RegistrationJoinRow[]> => {
  if (subjectIds.length === 0) {
    return [];
  }
  const result = await client.query<RegistrationJoinRow>(
    `${registrationSelect}
      where registration.organization_id = $1
        and registration.subject_id = any($2::text[])`,
    [organizationId, [...subjectIds]],
  );
  return result.rows;
};

const loadRowsForOrg = async (
  client: GovernanceQueryable,
  organizationId: string,
): Promise<RegistrationJoinRow[]> => {
  const result = await client.query<RegistrationJoinRow>(
    `${registrationSelect}
      where registration.organization_id = $1
      order by registration.id asc`,
    [organizationId],
  );
  return result.rows;
};

const encodeListCursor = (payload: {
  organizationId: string;
  principalId: string;
  lastId: string;
}): string =>
  Buffer.from(serializeContract(payload as unknown as ContractJsonValue), "utf8")
    .toString("base64url")
    .replace(/=+$/g, "");

const decodeListCursor = (
  cursor: string,
  organizationId: string,
  principalId: string,
): Result<string, GovernanceQueryFailure> => {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const parsed = JSON.parse(Buffer.from(`${padded}${pad}`, "base64").toString("utf8")) as {
      organizationId?: unknown;
      principalId?: unknown;
      lastId?: unknown;
    };
    if (
      parsed.organizationId !== organizationId ||
      parsed.principalId !== principalId ||
      !isUsableToken(parsed.lastId)
    ) {
      return fail({ kind: "invalid-cursor", reason: "scope-mismatch" });
    }
    return { ok: true, value: parsed.lastId };
  } catch {
    return fail({ kind: "invalid-cursor", reason: "malformed" });
  }
};

export const projectRegistrations = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: ProjectRegistrationsQuery,
): Promise<Result<RegistrationProjectionPage, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  return runQuery(source, "projectRegistrations", async (client) => {
    const rows = await loadRowsForSubjects(client, query.organizationId, query.subjectIds);
    const bySubject = new Map(rows.map((row) => [row.subject_id, row]));
    const reviewCounts = await loadReviewCountsBySubject(
      client,
      query.organizationId,
      query.subjectIds,
      query.observedRelease,
    );
    const projections = [];
    for (const subjectId of query.subjectIds) {
      const row = bySubject.get(subjectId);
      if (!row) {
        projections.push({
          subjectId,
          registration: { status: "unregistered" as const },
          reviewCount: reviewCounts.get(subjectId) ?? 0,
        });
        continue;
      }
      const registration = mapProjection(row);
      if (!registration.ok) {
        return registration;
      }
      projections.push({
        subjectId,
        registration: registration.value,
        reviewCount: reviewCounts.get(subjectId) ?? 0,
      });
    }
    return {
      ok: true,
      value: {
        semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS,
        projections,
      },
    };
  });
};

export const selectSubjectIds = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: RegistrationSelectionQuery,
): Promise<Result<SubjectIdSelection, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (
    query.registration !== undefined &&
    query.registration !== "active" &&
    query.registration !== "retired" &&
    query.registration !== "unregistered"
  ) {
    return fail({ kind: "invalid-query", reason: "registration" });
  }
  if (query.registration === "unregistered" && query.catalogSubjectIds === undefined) {
    return fail({ kind: "invalid-query", reason: "catalogSubjectIds" });
  }
  return runQuery(source, "selectSubjectIds", async (client) => {
    const result = await client.query<{ subject_id: string; status: string }>(
      `select subject_id, status
         from parameter_catalog.organization_subject_registrations
        where organization_id = $1`,
      [query.organizationId],
    );
    return {
      ok: true,
      value: selectSubjectIdsFromRows(result.rows, query.registration, query.catalogSubjectIds),
    };
  });
};

export const selectDefinitionIds = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: DefinitionSelectionQuery,
): Promise<Result<DefinitionIdSelection, GovernanceQueryFailure>> => {
  const subjects = await selectSubjectIds(source, {
    organizationId: query.organizationId,
    registration: query.registration,
    catalogSubjectIds: query.catalogDefinitions.map((entry) => entry.subjectId),
    authScope: query.authScope,
  });
  if (!subjects.ok) {
    return subjects;
  }
  return {
    ok: true,
    value: expandDefinitionSelection(subjects.value, query.catalogDefinitions),
  };
};

export const listRegistrations = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: ListRegistrationsQuery,
): Promise<Result<RegistrationList, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (!isUsableToken(query.observedCatalogReleaseId)) {
    return fail({ kind: "invalid-query", reason: "observedCatalogReleaseId" });
  }
  const limit = query.limit ?? LIST_LIMIT_DEFAULT;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > LIST_LIMIT_MAX) {
    return fail({ kind: "invalid-query", reason: "limit" });
  }
  let afterId: string | undefined;
  if (query.cursor) {
    const decoded = decodeListCursor(query.cursor, query.organizationId, query.authScope.principalId);
    if (!decoded.ok) return decoded;
    afterId = decoded.value;
  }
  return runQuery(source, "listRegistrations", async (client) => {
    const rows = await loadRowsForOrg(client, query.organizationId);
    const start = afterId ? rows.findIndex((row) => row.id > afterId) : 0;
    const sliceStart = afterId ? (start < 0 ? rows.length : start) : 0;
    const pageRows = rows.slice(sliceStart, sliceStart + limit);
    const items: GovernanceRegistrationRecord[] = [];
    for (const row of pageRows) {
      const mapped = mapRecord(row, query.observedCatalogReleaseId);
      if (!mapped.ok) return mapped;
      items.push(mapped.value);
    }
    const last = pageRows.at(-1);
    const nextCursor =
      last && sliceStart + pageRows.length < rows.length
        ? encodeListCursor({
            organizationId: query.organizationId,
            principalId: query.authScope.principalId,
            lastId: last.id,
          })
        : null;
    return {
      ok: true,
      value: {
        semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS,
        items,
        nextCursor,
        emptyReason: emptyReasonForView("registrations", items.length, Boolean(query.cursor)),
      },
    };
  });
};

export const getRegistration = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: GetRegistrationQuery,
): Promise<Result<GovernanceRegistrationRecord, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (!isUsableToken(query.registrationId) || !isUsableToken(query.observedCatalogReleaseId)) {
    return fail({ kind: "invalid-query", reason: "registrationId" });
  }
  return runQuery(source, "getRegistration", async (client) => {
    const result = await client.query<RegistrationJoinRow>(
      `${registrationSelect}
        where registration.organization_id = $1
          and registration.id = $2`,
      [query.organizationId, query.registrationId],
    );
    const row = result.rows[0];
    if (!row) {
      return fail({ kind: "not-found", resource: "registration" });
    }
    return mapRecord(row, query.observedCatalogReleaseId);
  });
};

export const getPlacement = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: GetPlacementQuery,
): Promise<Result<GovernancePlacementRecord, GovernanceQueryFailure>> => {
  const registration = await getRegistration(source, query);
  if (!registration.ok) {
    if (registration.error.kind === "not-found") {
      return fail({ kind: "not-found", resource: "placement" });
    }
    return registration;
  }
  return { ok: true, value: registration.value.placement };
};
