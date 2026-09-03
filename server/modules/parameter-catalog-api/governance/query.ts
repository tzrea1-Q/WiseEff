import {
  catalogForbiddenSpoofHeaders,
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogGovernanceRequest } from "./types";

export function queryValue(
  query: CatalogGovernanceRequest["query"],
  key: string,
): string | undefined {
  const value = query[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function headerValue(
  headers: CatalogGovernanceRequest["headers"],
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) {
      continue;
    }
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

export function stripSpoofHeaders(
  headers: CatalogGovernanceRequest["headers"],
): CatalogGovernanceRequest["headers"] {
  const stripped: Record<string, string | string[] | undefined> = { ...headers };
  for (const name of catalogForbiddenSpoofHeaders) {
    delete stripped[name];
    delete stripped[name.toLowerCase()];
  }
  return stripped;
}

export function catalogReleaseHeader(headers: CatalogGovernanceRequest["headers"]): string | undefined {
  return headerValue(headers, CATALOG_RELEASE_HEADER);
}

export function idempotencyKeyHeader(headers: CatalogGovernanceRequest["headers"]): string | undefined {
  return headerValue(headers, CATALOG_IDEMPOTENCY_HEADER);
}

export function ifMatchHeader(headers: CatalogGovernanceRequest["headers"]): string | undefined {
  return headerValue(headers, CATALOG_IF_MATCH_HEADER);
}

export function quoteEtag(value: string): string {
  const inner = value.replace(/"/g, "");
  return `"${inner}"`;
}

export function unquoteEtag(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("W/")) {
    return unquoteEtag(trimmed.slice(2).trim());
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseEtagVersion(value: string): number | null {
  const inner = unquoteEtag(value);
  const versionMatch = /-v(\d+)$/.exec(inner);
  if (versionMatch) {
    return Number(versionMatch[1]);
  }
  if (/^\d+$/.test(inner)) {
    const parsed = Number(inner);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}
