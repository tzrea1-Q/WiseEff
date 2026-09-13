import {
  catalogForbiddenSpoofHeaders,
  CATALOG_RELEASE_HEADER,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogPublicationRequest } from "./types";

export function headerValue(
  headers: CatalogPublicationRequest["headers"],
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
  headers: CatalogPublicationRequest["headers"],
): CatalogPublicationRequest["headers"] {
  const stripped: Record<string, string | string[] | undefined> = { ...headers };
  for (const name of catalogForbiddenSpoofHeaders) {
    delete stripped[name];
    delete stripped[name.toLowerCase()];
  }
  return stripped;
}

export function catalogReleaseHeader(headers: CatalogPublicationRequest["headers"]): string | undefined {
  return headerValue(headers, CATALOG_RELEASE_HEADER);
}
