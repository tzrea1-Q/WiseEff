import type { ReactNode } from "react";

import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsExportConfigSetResult,
  DtsSourceLocator,
  DtsStructuralNode
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileRepository,
  ProjectParameterFile,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import type { DtsViewerFocusSpan } from "@/components/parameter-topology/ProjectPrimaryDtsViewer";

export const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

export type PendingConfirmation = {
  key: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  tone: "primary" | "danger";
  run: () => Promise<void>;
};

export function downloadExportBundle(
  configSetName: string,
  result: Pick<DtsExportConfigSetResult, "manifest" | "files">
) {
  const filesPayload = result.files.map((file) => `// ${file.name}\n${file.content}`).join("\n\n");
  const payload = [
    "// wiseeff-config-set-export-manifest.json",
    JSON.stringify(result.manifest, null, 2),
    "",
    "// wiseeff-config-set-export-files",
    filesPayload
  ].join("\n");
  const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${configSetName || "config-set"}-export.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function defaultRoleForFile(file: ProjectParameterFile, hasMembers: boolean): ConfigSetRole {
  if (file.format === "json") return "misc";
  return hasMembers ? "overlay" : "base";
}

export function queryValue(search: string, name: string) {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(name);
}

export function defaultConfigSet(configSets: DtsConfigSet[]) {
  const namedDefault = configSets.find((item) => item.name.trim().toLowerCase() === "default");
  if (namedDefault) return namedDefault;
  return [...configSets].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  )[0] ?? null;
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

export function decodeSourceBytes(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

export async function triggerVersionDownload(
  fileRepository: ParameterFileRepository,
  projectId: string,
  fileId: string,
  version: ProjectParameterFileVersion,
  fileName: string
) {
  const result = await fileRepository.downloadVersion(projectId, fileId, version.id);
  const blob = new Blob([Uint8Array.from(result.bytes)], {
    type: result.contentType || "application/octet-stream"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.fileName || `${fileName}.v${version.versionNumber}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function locatorToFocusSpan(source?: DtsSourceLocator): DtsViewerFocusSpan | null {
  if (!source) return null;
  return {
    startLine: source.startLine,
    endLine: source.endLine,
    startColumn: source.startColumn,
    endColumn: source.endColumn
  };
}


export function nearestNodeForLine(nodes: DtsStructuralNode[], line: number): DtsStructuralNode | null {
  let best: DtsStructuralNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (!node.source) continue;
    if (line < node.source.startLine) continue;
    const distance = line - node.source.startLine;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

