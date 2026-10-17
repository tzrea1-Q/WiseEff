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

export async function downloadExportBundle(
  configSetName: string,
  result: Pick<DtsExportConfigSetResult, "manifest" | "files">
): Promise<void> {
  const manifestName = "wiseeff-config-set-export-manifest.json";
  if (!result?.manifest || typeof result.manifest !== "object" || Array.isArray(result.manifest)
    || !Array.isArray(result.files) || result.files.length >= 0xffff) {
    throw new Error("导出内容无效，无法生成 ZIP 文件。");
  }
  const names = new Set([manifestName]);
  const directories = new Set<string>();
  for (const file of result.files) {
    const parts = typeof file?.name === "string" ? file.name.split("/") : [];
    if (!parts.length || typeof file.content !== "string" || /^[a-z]:/i.test(file.name)
      || new TextEncoder().encode(file.name).length > 0xffff
      || parts.some((part) => !part || part === "." || part === ".." || /[\\\u0000\uD800-\uDFFF]/u.test(part))) {
      throw new Error(`导出文件路径或内容无效：${JSON.stringify(file?.name)}`);
    }
    const normalized = parts.map((part) => part.normalize("NFC").toLowerCase());
    const name = normalized.join("/");
    if (names.has(name) || directories.has(name)) {
      throw new Error(`导出文件路径重复或与清单冲突：${JSON.stringify(file.name)}`);
    }
    for (let index = 1; index < normalized.length; index += 1) {
      const parent = normalized.slice(0, index).join("/");
      if (names.has(parent)) throw new Error(`导出文件与目录路径冲突：${JSON.stringify(file.name)}`);
      directories.add(parent);
    }
    names.add(name);
  }
  const manifest = JSON.stringify(result.manifest, null, 2);
  if (typeof manifest !== "string") throw new Error("导出清单无效，无法生成 ZIP 文件。");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(manifestName, manifest);
  for (const file of result.files) zip.file(file.name, file.content, { createFolders: false });
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${configSetName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").trim() || "config-set"}-export.zip`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
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

