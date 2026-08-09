import type { DtsConfigSet } from "@/application/ports/DtsStructuredRepository";

export function queryValue(search: string, name: string) {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(name);
}

export function defaultConfigSet(configSets: DtsConfigSet[]) {
  const namedDefault = configSets.find((item) => item.name.trim().toLowerCase() === "default");
  if (namedDefault) return namedDefault;
  return (
    [...configSets].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )[0] ?? null
  );
}

export type WorkbenchPathPatch = {
  configSet: string;
  file?: string | null;
  node?: string | null;
  property?: string | null;
  sourceMode?: string | null;
  version?: string | null;
  candidate?: string | null;
  baseline?: string | null;
  inspector?: string | null;
};

export function formatWorkbenchPath(projectId: string, search: string, patch: WorkbenchPathPatch) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("configSet", patch.configSet);
  const setOrDelete = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value) params.set(key, value);
    else params.delete(key);
  };
  setOrDelete("file", patch.file);
  setOrDelete("node", patch.node);
  setOrDelete("property", patch.property);
  setOrDelete("sourceMode", patch.sourceMode);
  setOrDelete("version", patch.version);
  setOrDelete("candidate", patch.candidate);
  setOrDelete("baseline", patch.baseline);
  if (patch.inspector === null) {
    params.delete("inspector");
  } else if (patch.inspector !== undefined) {
    params.set("inspector", patch.inspector);
  }
  return `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration?${params.toString()}`;
}
