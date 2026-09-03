import {
  lookupProtectedIdentity,
  type MappingQueryable,
  type MappingTargetKind,
  type ProtectedLookupResult,
} from "../../catalog-cutover/mapping";
import {
  catalogLegacyIdentifierTypeSchema,
  catalogMappingTargetKindSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { legacyLookupIdentifierTypes } from "../../parameter-catalog-contract/index";

import {
  LEGACY_LOOKUP_SOURCE_SYSTEM,
  type CatalogLegacyIdentifierItem,
  type LegacyLookupFn,
  type LegacyLookupOutcome,
} from "./types";

const HISTORICAL_TARGET_KINDS: ReadonlySet<MappingTargetKind> = new Set([
  "definition-revision",
  "binding-history-event",
  "parameter-observation",
  "observation-match",
  "review-evidence",
  "review-resolution",
  "definition-proposal",
  "definition-proposal-revision",
  "publication-intent",
  "policy",
  "audit-event",
  "migration-history",
]);

const SINGLE_ID_HREF: Partial<Record<MappingTargetKind, (id: string) => string>> = {
  "catalog-subject": (id) => `/api/v2/catalog/subjects/${id}`,
  "parameter-definition": (id) => `/api/v2/catalog/definitions/${id}`,
  "definition-proposal": (id) => `/api/v2/catalog/definition-proposals/${id}`,
};

type ScopedTuple = {
  readonly sourceSystem: typeof LEGACY_LOOKUP_SOURCE_SYSTEM;
  readonly sourceKind: (typeof legacyLookupIdentifierTypes)[number];
  readonly ownerScopeKind: "platform" | "organization";
  readonly ownerScopeId: string;
  readonly sourceId: string;
};

const isAllowListedType = (
  value: string,
): value is (typeof legacyLookupIdentifierTypes)[number] =>
  (legacyLookupIdentifierTypes as readonly string[]).includes(value);

export function catalogTargetHref(kind: MappingTargetKind, id: string): string {
  return SINGLE_ID_HREF[kind]?.(id) ?? "/api/v2/catalog";
}

const mappedItem = (
  legacyType: (typeof legacyLookupIdentifierTypes)[number],
  legacyId: string,
  targetKind: MappingTargetKind,
  targetId: string,
): CatalogLegacyIdentifierItem => ({
  legacyType,
  legacyId,
  disposition: "mapped",
  target: {
    kind: catalogMappingTargetKindSchema.parse(targetKind),
    id: targetId,
    href: catalogTargetHref(targetKind, targetId),
  },
  historicalOnly: HISTORICAL_TARGET_KINDS.has(targetKind),
});

type Found =
  | { readonly status: "mapped"; readonly value: Extract<ProtectedLookupResult, { outcome: "mapped" }> }
  | { readonly status: "archived" }
  | { readonly status: "blocked" }
  | { readonly status: "conflict" };

const probeTuple = async (
  lookup: LegacyLookupFn,
  client: MappingQueryable,
  tuple: ScopedTuple,
): Promise<Found | "absent"> => {
  const result = await lookup({
    client,
    identity: {
      kind: "source-tuple",
      sourceSystem: tuple.sourceSystem,
      sourceKind: tuple.sourceKind,
      ownerScopeKind: tuple.ownerScopeKind,
      ownerScopeId: tuple.ownerScopeId,
      sourceId: tuple.sourceId,
    },
  });
  if (!result.ok) {
    if (result.error.code === "PCAT-MAP-CONFLICT") {
      return { status: "conflict" };
    }
    return "absent";
  }
  if (result.value.outcome === "blocked") {
    return { status: "blocked" };
  }
  if (result.value.outcome === "archived") {
    return { status: "archived" };
  }
  return { status: "mapped", value: result.value };
};

export async function lookupLegacyIdentifier(input: {
  client: MappingQueryable;
  lookup?: LegacyLookupFn;
  legacyType: string;
  legacyId: string;
  organizationId: string | null;
}): Promise<LegacyLookupOutcome> {
  const parsedType = catalogLegacyIdentifierTypeSchema.safeParse(input.legacyType);
  if (!parsedType.success || !isAllowListedType(parsedType.data)) {
    return { kind: "not-found" };
  }
  const legacyId = input.legacyId.trim();
  if (legacyId === "" || legacyId !== input.legacyId) {
    return { kind: "not-found" };
  }

  const tuples: ScopedTuple[] = [
    {
      sourceSystem: LEGACY_LOOKUP_SOURCE_SYSTEM,
      sourceKind: parsedType.data,
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: legacyId,
    },
  ];
  if (input.organizationId) {
    tuples.push({
      sourceSystem: LEGACY_LOOKUP_SOURCE_SYSTEM,
      sourceKind: parsedType.data,
      ownerScopeKind: "organization",
      ownerScopeId: input.organizationId,
      sourceId: legacyId,
    });
  }

  const lookup = input.lookup ?? lookupProtectedIdentity;
  const found: Found[] = [];
  for (const tuple of tuples) {
    const probe = await probeTuple(lookup, input.client, tuple);
    if (probe !== "absent") {
      found.push(probe);
    }
  }

  if (found.some((row) => row.status === "conflict") || found.length > 1) {
    return { kind: "ambiguous" };
  }
  if (found.length === 0) {
    return { kind: "not-found" };
  }
  const only = found[0]!;
  if (only.status === "blocked") {
    return { kind: "ambiguous" };
  }
  if (only.status === "archived") {
    return { kind: "archived" };
  }
  if (only.status !== "mapped") {
    return { kind: "not-found" };
  }
  return {
    kind: "mapped",
    item: mappedItem(parsedType.data, legacyId, only.value.targetKind, only.value.targetId),
  };
}
