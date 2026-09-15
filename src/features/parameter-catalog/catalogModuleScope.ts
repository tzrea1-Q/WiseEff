import type { CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";

type SubjectItem = CatalogSubjectResponse["item"];

export type CatalogNavigatorNodeKind = "module" | "subject" | "unregistered-group";

export type CatalogNavigatorNode = {
  /**
   * Module id (the value the server resolves as a subtree filter),
   * `subject:<subjectId>` for a subject leaf, or the synthetic unregistered
   * group id. The placement id only reconstructs the forest.
   */
  id: string;
  kind: CatalogNavigatorNodeKind;
  displayName: string;
  /** Secondary line for subject leaves (type and registration state). */
  meta?: string;
  /** Placed subjects at or below this node; `0` for a subject leaf. */
  subjectCount: number;
  /** Set on subject leaves so the page can filter by the exact subject. */
  subjectId?: string;
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

export const CATALOG_UNREGISTERED_GROUP_ID = "group:unregistered";

/** Group node label for subjects that carry no usable placement yet. */
export const CATALOG_UNREGISTERED_GROUP_LABEL = "未登记主体";

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

function subjectLeaf(subject: SubjectItem, describeSubject: (item: SubjectItem) => string): CatalogNavigatorNode {
  return {
    id: `subject:${subject.id}`,
    kind: "subject",
    displayName: subject.canonicalName,
    meta: describeSubject(subject),
    subjectCount: 0,
    subjectId: subject.id,
    children: []
  };
}

/**
 * Build the organization module navigator from the retained subject placements.
 *
 * The navigator is **one** tree, not a module list beside a subject list: module
 * placements form the branches and every subject is a leaf — registered subjects
 * under the module they are placed in, and the subjects that have no usable
 * placement yet under one `未登记主体` branch so registration stays reachable.
 * `subject_placements` keeps one placement per registration and one registration
 * per (organization, subject), so the placement graph is a forest. The traversal
 * mirrors the server's module scope so the navigator, the column filter and the
 * reported count all describe the same subtree.
 */
export function buildCatalogModuleTree(
  subjects: readonly SubjectItem[],
  describeSubject: (item: SubjectItem) => string
): CatalogNavigatorNode[] {
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

  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectsByModuleId = new Map<string, SubjectItem[]>();
  const placedSubjectIds = new Set<string>();
  for (const link of links) {
    placedSubjectIds.add(link.subjectId);
    const subject = subjectsById.get(link.subjectId);
    if (!subject) continue;
    const bucket = subjectsByModuleId.get(link.moduleId) ?? [];
    bucket.push(subject);
    subjectsByModuleId.set(link.moduleId, bucket);
  }

  const sortSubjects = (items: SubjectItem[]): SubjectItem[] =>
    items
      .slice()
      .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, "zh-CN"));

  const build = (parentId: string | null, depth: number): CatalogNavigatorNode[] => {
    if (depth > 64) return [];
    return (childrenOf.get(parentId) ?? [])
      .slice()
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "zh-CN") ||
        left.placementId.localeCompare(right.placementId)
      )
      .map((link) => {
        const childModules = build(link.placementId, depth + 1);
        const leaves = sortSubjects(subjectsByModuleId.get(link.moduleId) ?? []).map((subject) =>
          subjectLeaf(subject, describeSubject)
        );
        return {
          id: link.moduleId,
          kind: "module" as const,
          displayName: link.displayName,
          subjectCount:
            childModules.reduce((total, child) => total + child.subjectCount, 0) + leaves.length,
          children: [...childModules, ...leaves]
        };
      });
  };

  const roots = build(null, 0);

  // Registered subjects whose placement is missing from the forest still belong
  // to the organization inventory; keep them reachable in the same tree.
  const orphans = sortSubjects(
    subjects.filter(
      (subject) =>
        subject.registration.status !== "unregistered" && !placedSubjectIds.has(subject.id)
    )
  );
  const unregistered = sortSubjects(
    subjects.filter((subject) => subject.registration.status === "unregistered")
  );
  const loose = [...orphans, ...unregistered];
  if (loose.length > 0) {
    roots.push({
      id: CATALOG_UNREGISTERED_GROUP_ID,
      kind: "unregistered-group",
      displayName: CATALOG_UNREGISTERED_GROUP_LABEL,
      subjectCount: loose.length,
      children: loose.map((subject) => subjectLeaf(subject, describeSubject))
    });
  }

  return roots;
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
