import type { ReactNode } from "react";

import type {
  ConfigSetRole,
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

export {
  defaultConfigSet,
  formatWorkbenchPath,
  queryValue,
  type WorkbenchPathPatch
} from "@/application/project-configuration/workbenchPath";

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

