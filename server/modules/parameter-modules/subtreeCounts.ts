export type AttributionCountFact = {
  moduleId: string;
  parameterSpecId: string;
};

export type SubtreeAttributionCounts = {
  parameterCount: number;
  definitionCount: number;
};

/**
 * Registry subtree totals for D4 / TD-052.
 * `parameterCount` is bindings (measured occurrences). `definitionCount` is
 * distinct `parameter_spec_id` in the same subtree — a union, not a sum of children.
 */
export function rollupSubtreeAttributionCounts(
  modules: readonly { id: string; parentId: string | null }[],
  facts: readonly AttributionCountFact[]
): ReadonlyMap<string, SubtreeAttributionCounts> {
  const childrenByParent = new Map<string, string[]>();
  for (const module of modules) {
    if (!module.parentId) continue;
    const siblings = childrenByParent.get(module.parentId) ?? [];
    siblings.push(module.id);
    childrenByParent.set(module.parentId, siblings);
  }

  const descendantCache = new Map<string, Set<string>>();
  const visiting = new Set<string>();

  const descendantsOf = (moduleId: string): Set<string> => {
    const cached = descendantCache.get(moduleId);
    if (cached) return cached;
    const ids = new Set<string>([moduleId]);
    if (visiting.has(moduleId)) return ids;
    visiting.add(moduleId);
    for (const childId of childrenByParent.get(moduleId) ?? []) {
      for (const id of descendantsOf(childId)) ids.add(id);
    }
    visiting.delete(moduleId);
    descendantCache.set(moduleId, ids);
    return ids;
  };

  const factsByModule = new Map<string, AttributionCountFact[]>();
  for (const fact of facts) {
    const list = factsByModule.get(fact.moduleId) ?? [];
    list.push(fact);
    factsByModule.set(fact.moduleId, list);
  }

  const totals = new Map<string, SubtreeAttributionCounts>();
  for (const module of modules) {
    let parameterCount = 0;
    const specIds = new Set<string>();
    for (const id of descendantsOf(module.id)) {
      for (const fact of factsByModule.get(id) ?? []) {
        parameterCount += 1;
        specIds.add(fact.parameterSpecId);
      }
    }
    totals.set(module.id, { parameterCount, definitionCount: specIds.size });
  }
  return totals;
}
