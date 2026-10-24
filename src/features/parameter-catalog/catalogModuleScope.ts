import type { CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { buildModuleTree, collectSubtreeModuleIds, type ModuleTreeNode } from "@/domain/modules/moduleTree";
import { toAttributionFlatNodes } from "@/components/parameter-topology/moduleAttributionTreeUtils";

type SubjectItem = CatalogSubjectResponse["item"];
export type CatalogModule = Pick<ParameterModule, "id" | "name" | "parentId" | "sortOrder">;

export type CatalogNavigatorNodeKind = "module" | "subject" | "unregistered-group";

export type CatalogNavigatorNode = {
  /**
   * Module id (the value the server resolves as a subtree filter),
   * `subject:<subjectId>` for a subject leaf, or the synthetic unregistered
   * group id. Module relationships come from the maintained module registry.
   */
  id: string;
  kind: CatalogNavigatorNodeKind;
  displayName: string;
  /** Secondary line for subject leaves (type and registration state). */
  meta?: string;
  subjectType?: SubjectItem["type"];
  retired?: boolean;
  /** Placed subjects at or below this node; `0` for a subject leaf. */
  subjectCount: number;
  /** Set on subject leaves so the page can filter by the exact subject. */
  subjectId?: string;
  children: CatalogNavigatorNode[];
};

export const CATALOG_UNREGISTERED_GROUP_ID = "group:unregistered";

/** Group node label for subjects that carry no usable placement yet. */
export const CATALOG_UNREGISTERED_GROUP_LABEL = "未登记主体";

function subjectLeaf(subject: SubjectItem, describeSubject: (item: SubjectItem) => string): CatalogNavigatorNode {
  return {
    id: `subject:${subject.id}`,
    kind: "subject",
    displayName: subject.canonicalName,
    meta: describeSubject(subject),
    subjectType: subject.type,
    retired: subject.membership.status === "retired" || subject.registration.status === "retired",
    subjectCount: 0,
    subjectId: subject.id,
    children: []
  };
}

/**
 * Reuse the maintained taxonomy, including categories without registrations.
 * Placements attach subject leaves; they do not define module relationships.
 */
export function buildCatalogModuleTree(
  subjects: readonly SubjectItem[],
  describeSubject: (item: SubjectItem) => string,
  modules: readonly CatalogModule[]
): CatalogNavigatorNode[] {
  const moduleIds = new Set(modules.map(module => module.id));
  const subjectsByModuleId = new Map<string, SubjectItem[]>();
  const placedSubjectIds = new Set<string>();
  for (const subject of subjects) {
    const moduleId = subject.registration.status === "unregistered" ? null : subject.registration.placement?.moduleId;
    if (!moduleId || !moduleIds.has(moduleId)) continue;
    placedSubjectIds.add(subject.id);
    const bucket = subjectsByModuleId.get(moduleId) ?? [];
    bucket.push(subject);
    subjectsByModuleId.set(moduleId, bucket);
  }

  const sortSubjects = (items: SubjectItem[]): SubjectItem[] =>
    items
      .slice()
      .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, "zh-CN"));

  const build = (nodes: readonly ModuleTreeNode[]): CatalogNavigatorNode[] =>
    nodes.map((module) => {
      const childModules = build(module.children);
      const leaves = sortSubjects(subjectsByModuleId.get(module.id) ?? []).map((subject) =>
        subjectLeaf(subject, describeSubject)
      );
      return {
        id: module.id,
        kind: "module" as const,
        displayName: module.name,
        subjectCount:
          childModules.reduce((total, child) => total + child.subjectCount, 0) + leaves.length,
        children: [...childModules, ...leaves]
      };
    });
  const roots = build(buildModuleTree(toAttributionFlatNodes(modules)));

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
  const unset = orphans.filter((subject) => subject.registration.status !== "unregistered" && subject.registration.placement);
  if (unset.length > 0) {
    roots.push({
      id: "group:unset",
      kind: "unregistered-group",
      displayName: "unset（未分配模块）",
      subjectCount: unset.length,
      children: unset.map((subject) => subjectLeaf(subject, describeSubject))
    });
  }
  const loose = [...orphans.filter((subject) => !unset.includes(subject)), ...unregistered];
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
  moduleNodeId: string,
  modules: readonly CatalogModule[]
): Set<string> {
  const moduleIds = collectSubtreeModuleIds(toAttributionFlatNodes(modules), [moduleNodeId]);
  return new Set(subjects.filter(subject => subject.registration.status !== "unregistered" &&
    subject.registration.placement?.moduleId && moduleIds.has(subject.registration.placement.moduleId)).map(subject => subject.id));
}
