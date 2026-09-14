import type { CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";

type SubjectItem = CatalogSubjectResponse["item"];

export type CatalogNavigatorNode = {
  /** Placement id, which is also the module filter value the server resolves. */
  id: string;
  displayName: string;
  subjectCount: number;
  children: CatalogNavigatorNode[];
};

type PlacementLink = {
  /** Placement id, used to reconstruct the placement forest. */
  placementId: string;
  /** Organization module the placement points at; this is what the server filters on. */
  moduleId: string;
  displayName: string;
  parentPlacementId: string | null;
  subjectId: string;
};

function placementLinks(subjects: readonly SubjectItem[]): PlacementLink[] {
  const links: PlacementLink[] = [];
  for (const subject of subjects) {
    if (subject.registration.status === "unregistered") continue;
    const placement = subject.registration.placement;
    if (!placement?.id) continue;
    links.push({
      placementId: placement.id,
      moduleId: placement.moduleId || placement.id,
      displayName: placement.displayName || placement.id,
      parentPlacementId: placement.parentPlacementId ?? null,
      subjectId: subject.id
    });
  }
  return links;
}

/**
 * Build the organization module navigator from the retained subject placements.
 *
 * `subject_placements` keeps one placement per registration and one registration
 * per (organization, subject), so the placement graph is a forest. This mirrors
 * the server's module traversal so the navigator, the column filter and the
 * reported count all describe the same subtree.
 */
export function buildCatalogModuleTree(subjects: readonly SubjectItem[]): CatalogNavigatorNode[] {
  const links = placementLinks(subjects);
  const byId = new Map(links.map((link) => [link.placementId, link]));
  const childrenOf = new Map<string | null, PlacementLink[]>();
  for (const link of links) {
    const parentId = link.parentPlacementId && byId.has(link.parentPlacementId)
      ? link.parentPlacementId
      : null;
    const bucket = childrenOf.get(parentId) ?? [];
    bucket.push(link);
    childrenOf.set(parentId, bucket);
  }

  const build = (parentId: string | null, depth: number): CatalogNavigatorNode[] => {
    if (depth > 64) return [];
    return (childrenOf.get(parentId) ?? [])
      .slice()
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "zh-CN") ||
        left.placementId.localeCompare(right.placementId)
      )
      .map((link) => {
        const children = build(link.placementId, depth + 1);
        return {
          /**
           * The navigator value is the organization module id, because the
           * server resolves a module subtree to its placed subjects before
           * pagination. The placement id only reconstructs the forest.
           */
          id: link.moduleId,
          displayName: link.displayName,
          subjectCount:
            children.reduce((total, child) => total + child.subjectCount, 0) + 1,
          children
        };
      });
  };

  return build(null, 0);
}

/** Subject ids placed at or below the given module node. */
export function subjectIdsForModule(
  subjects: readonly SubjectItem[],
  moduleNodeId: string
): Set<string> {
  const links = placementLinks(subjects);
  const byId = new Map(links.map((link) => [link.placementId, link]));
  const result = new Set<string>();
  for (const link of links) {
    let current: string | null = link.placementId;
    let depth = 0;
    while (current && depth <= 64) {
      const node = byId.get(current);
      if (node?.moduleId === moduleNodeId) {
        result.add(link.subjectId);
        break;
      }
      current = node?.parentPlacementId ?? null;
      depth += 1;
    }
  }
  return result;
}

/** Alias used by the table filter to keep the intent explicit at the call site. */
export function filterDefinitionIdsByModule(
  subjects: readonly SubjectItem[],
  moduleNodeId: string
): Set<string> {
  return subjectIdsForModule(subjects, moduleNodeId);
}
