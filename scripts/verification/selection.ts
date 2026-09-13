export const feedbackModuleIds = ["feedback-client", "feedback-domain", "feedback-server", "feedback-ui"] as const;
export const requiredTasks = ["acceptance-ci", "dts-toolchain", "dtc-seed", "build", "docs", "ui", "lint", "frontend-tests", "pgvector", "scripts-tests", "catalog-boundary", "bridge-tests", "backend-tests", "contract", "logs-eval", "quality", "smoke"] as const;
export const requiredGroups = ["static-build", "frontend-tests", "backend-tests", "scripts-bridge-tests", "quality", "smoke"] as const;

export type Changed = { status: string; paths: string[] };
export type RegistryModule = {
  id: string;
  status: "observation-pending";
  risk: "R2" | "R3";
  paths: string[];
  dependencies: string[];
  consumers: string[];
  tasks: Record<string, string[]>;
  browser: { spec: string; pages: string[]; roles: string[]; flows: string[]; environment: "owned-postgres-browser" };
};
export type Selection = {
  modules: string[];
  tasks: string[];
  reasons: string[];
  fullFallback: boolean;
  moduleStates: Array<{ id: string; status: "observation-pending"; risk: "R2" | "R3"; selected: boolean }>;
};
const defaultRisk: Record<string, "R2" | "R3"> = { "feedback-domain": "R3", "feedback-client": "R2", "feedback-server": "R2", "feedback-ui": "R2" };

function matches(file: string, pattern: string): boolean {
  return pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern;
}

function moduleKey(module: RegistryModule): string { return JSON.stringify(module); }

function policyBoundary(file: string): boolean {
  return /(?:^|\/)(?:auth|rbac|migrations|database|catalog|kernel)(?:\/|-)|^src\/(?:domain|application\/ports)\/|\.(?:css|sql)$|(?:^|\/)(?:package(?:-lock)?\.json|[^/]*config[^/]*|[^/]*fixture[^/]*)$|^scripts\/|^\.github\//i.test(file);
}

export function selectModules(input: { changed: Changed[]; base: RegistryModule[] | null; head: RegistryModule[] | null; registryMissing?: boolean }): Selection {
  const combined = new Map<string, RegistryModule>();
  for (const module of [...(input.base ?? []), ...(input.head ?? [])]) if (!combined.has(module.id)) combined.set(module.id, module);
  const all = [...combined.values()].sort((a, b) => a.id.localeCompare(b.id));
  const allIds = [...new Set([...feedbackModuleIds, ...all.map(module => module.id)])].sort();
  const reasons: string[] = [];
  const selected = new Set<string>();
  const baseById = new Map((input.base ?? []).map(module => [module.id, module]));
  const headById = new Map((input.head ?? []).map(module => [module.id, module]));

  if (input.registryMissing || !input.base || !input.head) reasons.push("REGISTRY_MAPPING_MISSING_FULL");
  for (const id of new Set([...baseById.keys(), ...headById.keys()])) {
    const before = baseById.get(id);
    const after = headById.get(id);
    if (!before || !after || moduleKey(before) !== moduleKey(after)) reasons.push("REGISTRY_MAPPING_DRIFT_FULL");
  }
  if (!input.changed.length) reasons.push("EMPTY_DIFF_FULL");
  for (const change of input.changed) {
    if (/^[DRC]/.test(change.status)) reasons.push("DELETION_OR_RENAME_FULL");
    for (const file of change.paths) {
      if (policyBoundary(file)) reasons.push("POLICY_BOUNDARY_FULL");
      const owners = all.filter(module => [...module.paths, ...module.consumers].some(pattern => matches(file, pattern)));
      if (owners.length === 1) selected.add(owners[0].id);
      else reasons.push("UNKNOWN_OR_SHARED_PATH_FULL");
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const module of all) if (!selected.has(module.id) && module.dependencies.some(id => selected.has(id))) { selected.add(module.id); changed = true; }
  }
  const fullFallback = reasons.length > 0;
  const modules = fullFallback ? allIds : [...selected].sort();
  const tasks = fullFallback ? [...requiredTasks] : [...new Set(modules.flatMap(id => combined.get(id)?.tasks ? Object.keys(combined.get(id)!.tasks) : []))].sort();
  return {
    modules,
    tasks,
    reasons: [...new Set(reasons)],
    fullFallback,
    moduleStates: allIds.map(id => {
      const module = combined.get(id);
      return { id, status: "observation-pending", risk: module?.risk ?? defaultRisk[id]!, selected: modules.includes(id) };
    }),
  };
}
