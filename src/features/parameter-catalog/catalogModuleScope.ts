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
   * `subject:<subjectId>` for a subject, or the synthetic unregistered
   * group id. Module relationships come from the maintained module registry.
   */
  id: string;
  kind: CatalogNavigatorNodeKind;
  displayName: string;
  /** Secondary line for subject leaves (type and registration state). */
  meta?: string;
  subjectType?: SubjectItem["type"];
  retired?: boolean;
  /** Descendant subjects; module/group counts include their direct subjects. */
  subjectCount: number;
  /** Set on subjects so the page can filter by the exact subject. */
  subjectId?: string;
  children: CatalogNavigatorNode[];
};

export const CATALOG_UNREGISTERED_GROUP_ID = "group:unregistered";

/** Group node label for subjects that carry no usable placement yet. */
export const CATALOG_UNREGISTERED_GROUP_LABEL = "待登记主体";

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
 * Placements attach subjects; they do not define module relationships. The
 * library can additionally nest node types using the read DTO's exact owner.
 */
export function buildCatalogModuleTree(
  subjects: readonly SubjectItem[],
  describeSubject: (item: SubjectItem) => string,
  modules: readonly CatalogModule[],
  options: { nestOwnedNodeTypes?: boolean } = {}
): CatalogNavigatorNode[] {
  const subjectNodes = new Map(subjects.map(subject => [subject.id, subjectLeaf(subject, describeSubject)]));
  const nestedSubjectIds = new Set<string>();
  if (options.nestOwnedNodeTypes) {
    for (const subject of subjects) {
      if (subject.type !== "node-type" || !subject.ownerSubjectId) continue;
      const owner = subjectNodes.get(subject.ownerSubjectId);
      if (owner?.subjectType !== "driver") continue;
      owner.children.push(subjectNodes.get(subject.id)!);
      owner.subjectCount += 1;
      nestedSubjectIds.add(subject.id);
    }
    for (const node of subjectNodes.values()) {
      node.children.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
    }
  }
  const rootSubjects = subjects.filter(subject => !nestedSubjectIds.has(subject.id));
  const subjectNode = (subject: SubjectItem) => subjectNodes.get(subject.id)!;
  const subjectCount = (items: readonly SubjectItem[]) => items.reduce((count, subject) => count + 1 + subjectNode(subject).subjectCount, 0);
  const moduleIds = new Set(modules.map(module => module.id));
  const subjectsByModuleId = new Map<string, SubjectItem[]>();
  const placedSubjectIds = new Set<string>();
  for (const subject of rootSubjects) {
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
      const placed = subjectsByModuleId.get(module.id) ?? [];
      const leaves = sortSubjects(placed).map(subjectNode);
      return {
        id: module.id,
        kind: "module" as const,
        displayName: module.name,
        subjectCount:
          childModules.reduce((total, child) => total + child.subjectCount, 0) + subjectCount(placed),
        children: [...childModules, ...leaves]
      };
    });
  const roots = build(buildModuleTree(toAttributionFlatNodes(modules)));

  // Registered subjects whose placement is missing from the forest still belong
  // to the organization inventory; keep them reachable in the same tree.
  const orphans = sortSubjects(
    rootSubjects.filter(
      (subject) =>
        subject.registration.status !== "unregistered" && !placedSubjectIds.has(subject.id)
    )
  );
  const unregistered = sortSubjects(
    rootSubjects.filter((subject) => subject.registration.status === "unregistered")
  );
  const unset = orphans.filter((subject) => subject.registration.status !== "unregistered" && subject.registration.placement);
  if (unset.length > 0) {
    roots.push({
      id: "group:unset",
      kind: "unregistered-group",
      displayName: "unset（未分配模块）",
      subjectCount: subjectCount(unset),
      children: unset.map(subjectNode)
    });
  }
  const loose = [...orphans.filter((subject) => !unset.includes(subject)), ...unregistered];
  if (loose.length > 0) {
    roots.push({
      id: CATALOG_UNREGISTERED_GROUP_ID,
      kind: "unregistered-group",
      displayName: CATALOG_UNREGISTERED_GROUP_LABEL,
      subjectCount: subjectCount(loose),
      children: loose.map(subjectNode)
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
