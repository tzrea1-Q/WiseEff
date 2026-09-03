import { createHash } from "node:crypto";

import { PropertyKey } from "../../catalog-kernel/interface";
import {
  catalogForbiddenSpoofHeaders,
  CATALOG_RELEASE_HEADER,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { hasLegacyParameterSpecId } from "../../parameter-bindings/adapters/dto";
import {
  CatalogCursor,
  CatalogPageLimit,
  CatalogSearchText,
  CatalogSubjectId,
  ParameterDefinitionId,
  serializeContract,
  type CatalogSubjectKind,
  type ContractJsonValue,
  type DefinitionLifecycle,
  type SubjectLifecycle,
} from "../../parameter-catalog-contract/index";
import { validationFailed } from "./errors";
import type {
  CatalogIdSelection,
  CatalogListQuery,
  CatalogReadRequest,
  CatalogReadResponse,
} from "./types";

export const CATALOG_READ_DEFAULT_PAGE_LIMIT = 50;
export const CATALOG_READ_MAX_PAGE_LIMIT = 100;

const present = <T>(value: T): { readonly kind: "present"; readonly value: T } => ({
  kind: "present",
  value,
});
const absent = { kind: "absent" as const };

const SUBJECT_KINDS = new Set<CatalogSubjectKind>(["driver", "node-type"]);
const SUBJECT_LIFECYCLES = new Set<SubjectLifecycle>(["active", "retired"]);
const DEFINITION_LIFECYCLES = new Set<DefinitionLifecycle>(["active", "deprecated", "retired"]);
const REGISTRATION_FILTERS = new Set(["unregistered", "active", "retired"]);

export function queryValue(
  query: Record<string, string | string[]>,
  key: string,
): string | undefined {
  const value = query[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

export function stripSpoofHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const stripped: Record<string, string | string[] | undefined> = { ...headers };
  for (const name of catalogForbiddenSpoofHeaders) {
    delete stripped[name];
    delete stripped[name.toLowerCase()];
  }
  return stripped;
}

export function requestCarriesLegacySpecIdentity(request: CatalogReadRequest): boolean {
  return (
    hasLegacyParameterSpecId(request.query) ||
    hasLegacyParameterSpecId(request.params) ||
    hasLegacyParameterSpecId(request.headers)
  );
}

export function fingerprintIdSelection(ids: readonly string[]): string {
  const ordered = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return `sha256:${createHash("sha256").update(serializeContract(ordered as ContractJsonValue)).digest("hex")}`;
}

export function mergeIdSelection<Id extends string>(
  left: CatalogIdSelection<Id>,
  right: CatalogIdSelection<Id>,
): CatalogIdSelection<Id> {
  if (left.kind === "all") {
    return right;
  }
  if (right.kind === "all") {
    return left;
  }
  const allowed = new Set(right.ids);
  const ids = left.ids.filter((id) => allowed.has(id));
  return { kind: "only", ids, fingerprint: fingerprintIdSelection(ids) };
}

export function observedReleaseId(request: CatalogReadRequest): string | undefined {
  return queryValue(request.query, "catalogReleaseId") ?? headerValue(request.headers, CATALOG_RELEASE_HEADER);
}

export function parseCatalogListQuery(
  request: CatalogReadRequest,
): { readonly ok: true; readonly query: CatalogListQuery } | { readonly ok: false; readonly response: CatalogReadResponse } {
  const cursorRaw = queryValue(request.query, "cursor");
  const limitRaw = queryValue(request.query, "limit");
  const typeRaw = queryValue(request.query, "type");
  const lifecycleRaw = queryValue(request.query, "lifecycle");
  const registrationRaw = queryValue(request.query, "registration");
  const searchRaw = queryValue(request.query, "search");
  const subjectIdRaw = queryValue(request.query, "subjectId");
  const propertyKeyRaw = queryValue(request.query, "propertyKey");

  let limit = CATALOG_READ_DEFAULT_PAGE_LIMIT;
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > CATALOG_READ_MAX_PAGE_LIMIT) {
      return { ok: false, response: validationFailed(request.requestId, "limit") };
    }
    limit = parsed;
  }

  let cursor: CatalogListQuery["cursor"] = absent;
  if (cursorRaw !== undefined && cursorRaw.length > 0) {
    try {
      cursor = present(CatalogCursor(cursorRaw));
    } catch {
      return { ok: false, response: validationFailed(request.requestId, "cursor") };
    }
  }

  if (typeRaw !== undefined && !SUBJECT_KINDS.has(typeRaw as CatalogSubjectKind)) {
    return { ok: false, response: validationFailed(request.requestId, "type") };
  }
  if (registrationRaw !== undefined && !REGISTRATION_FILTERS.has(registrationRaw)) {
    return { ok: false, response: validationFailed(request.requestId, "registration") };
  }

  let subjectId: CatalogSubjectId | undefined;
  if (subjectIdRaw !== undefined) {
    try {
      subjectId = CatalogSubjectId(subjectIdRaw);
    } catch {
      return { ok: false, response: validationFailed(request.requestId, "subjectId") };
    }
  }

  let propertyKey: PropertyKey | undefined;
  if (propertyKeyRaw !== undefined) {
    try {
      propertyKey = PropertyKey(propertyKeyRaw);
    } catch {
      return { ok: false, response: validationFailed(request.requestId, "propertyKey") };
    }
  }

  if (searchRaw !== undefined && searchRaw.length > 0) {
    try {
      CatalogSearchText(searchRaw);
    } catch {
      return { ok: false, response: validationFailed(request.requestId, "search") };
    }
  }

  return {
    ok: true,
    query: {
      cursor,
      limit,
      type: typeRaw as CatalogListQuery["type"],
      lifecycle: lifecycleRaw,
      registration: registrationRaw,
      search: searchRaw,
      subjectId,
      propertyKey,
    },
  };
}

export function catalogPageLimit(limit: number): CatalogPageLimit {
  return CatalogPageLimit(limit);
}

export function searchValue(search: string | undefined): { kind: "present"; value: ReturnType<typeof CatalogSearchText> } | typeof absent {
  if (!search) {
    return absent;
  }
  return present(CatalogSearchText(search));
}

export function defaultSubjectLifecycles(lifecycle: string | undefined): readonly SubjectLifecycle[] {
  if (!lifecycle) {
    return ["active"];
  }
  if (!SUBJECT_LIFECYCLES.has(lifecycle as SubjectLifecycle)) {
    throw new TypeError("lifecycle");
  }
  return [lifecycle as SubjectLifecycle];
}

export function defaultDefinitionLifecycles(lifecycle: string | undefined): readonly DefinitionLifecycle[] {
  if (!lifecycle) {
    return ["active"];
  }
  if (!DEFINITION_LIFECYCLES.has(lifecycle as DefinitionLifecycle)) {
    throw new TypeError("lifecycle");
  }
  return [lifecycle as DefinitionLifecycle];
}

export function subjectKinds(type: CatalogListQuery["type"]): readonly CatalogSubjectKind[] {
  return type ? [type] : [];
}

export function asSubjectId(value: string, requestId: string): { ok: true; value: CatalogSubjectId } | { ok: false; response: CatalogReadResponse } {
  try {
    return { ok: true, value: CatalogSubjectId(value) };
  } catch {
    return { ok: false, response: validationFailed(requestId, "subjectId") };
  }
}

export function asDefinitionId(value: string, requestId: string): { ok: true; value: ParameterDefinitionId } | { ok: false; response: CatalogReadResponse } {
  try {
    return { ok: true, value: ParameterDefinitionId(value) };
  } catch {
    return { ok: false, response: validationFailed(requestId, "definitionId") };
  }
}

export { present, absent };
