import pg from "pg";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import {
  loadPublishedCatalog,
  parseCompatibles,
  resolveObservedSubject,
} from "../parameter-bindings/catalogProjectValueSync";
import { createGovernanceCatalogQueries, type GovernanceQueryAuthScope } from "../parameter-governance/queries";

type NavigationNode = {
  nodePath: string;
  name: string;
  compatible?: string;
  properties?: readonly { name: string; rawText: string }[];
};

export type OrganizationNavigationScope =
  | {
      status: "ready";
      catalogReleaseId: string;
      matchNodePaths: (nodes: readonly NavigationNode[]) => string[];
    }
  | { status: "unavailable"; reason: "catalog-unavailable" | "registration-unavailable" };

const connectionCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);

/** Current organization registration, with one immutable Catalog snapshot per request. */
export async function loadOrganizationNavigationScope(
  db: Queryable,
  authScope: GovernanceQueryAuthScope,
): Promise<OrganizationNavigationScope> {
  const pool = getRootPostgresPool(db as Database);
  if (!pool) return { status: "unavailable", reason: "catalog-unavailable" };
  let snapshot: Awaited<ReturnType<typeof loadPublishedCatalog>>;
  try {
    snapshot = await loadPublishedCatalog(pool);
  } catch (error) {
    if (error instanceof pg.DatabaseError ||
        (error !== null && typeof error === "object" && "code" in error && connectionCodes.has(String(error.code)))) {
      return { status: "unavailable", reason: "catalog-unavailable" };
    }
    throw error;
  }
  if (!snapshot) return { status: "unavailable", reason: "catalog-unavailable" };

  const registration = await createGovernanceCatalogQueries(pool).selectSubjectIds({
    organizationId: authScope.organizationId,
    authScope,
    registration: "active",
  });
  if (!registration.ok) return { status: "unavailable", reason: "registration-unavailable" };
  const selection = registration.value;
  const registered = new Set<string>(selection.kind === "only" ? selection.ids : []);
  const matches = new Map<string, boolean>();

  return {
    status: "ready",
    catalogReleaseId: snapshot.release.id,
    matchNodePaths: (nodes) => nodes.filter((node) => {
      // dts_nodes.compatible stores only the first string; the property preserves fallback selectors.
      const raw = node.properties?.find((property) => property.name === "compatible")?.rawText;
      const compatibles = raw !== undefined ? parseCompatibles(raw) : node.compatible ? [node.compatible] : [];
      const selector = JSON.stringify([compatibles, compatibles.length ? null : node.name]);
      if (!matches.has(selector)) {
        const subject = resolveObservedSubject(snapshot, { compatibles, nodeName: node.name });
        matches.set(selector, subject !== null && registered.has(subject.subjectId));
      }
      return matches.get(selector) === true;
    }).map((node) => node.nodePath),
  };
}

/** Retain only ancestors that actually exist in this file, using complete path segments. */
export function navigationPathsWithAncestors(
  nodes: readonly { nodePath: string }[],
  managedNodePaths: readonly string[],
): Set<string> {
  const paths = new Set(nodes.map((node) => node.nodePath));
  const visible = new Set<string>();
  for (const path of managedNodePaths) {
    let ancestor = path;
    while (true) {
      if (paths.has(ancestor)) visible.add(ancestor);
      const separator = ancestor.lastIndexOf("/");
      if (separator < 0) break;
      ancestor = ancestor.slice(0, separator);
    }
    if (paths.has("")) visible.add("");
    if (paths.has("/")) visible.add("/");
  }
  return visible;
}
