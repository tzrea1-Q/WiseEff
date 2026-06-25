import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { ApiError } from "../../shared/http/errors";
import type { RouteHandler, RouteResponse } from "../../shared/http/router";

function contentTypeForArtifact(fileName: string) {
  if (fileName.endsWith(".zip")) {
    return "application/zip";
  }
  if (fileName.endsWith(".tar.gz") || fileName.endsWith(".tgz")) {
    return "application/gzip";
  }
  if (fileName.endsWith(".pkg")) {
    return "application/octet-stream";
  }
  if (fileName.endsWith(".exe")) {
    return "application/vnd.microsoft.portable-executable";
  }
  return "application/octet-stream";
}

function resolveArtifactPath(input: {
  artifactRoot: string;
  version: string;
  platform: string;
  arch: string;
  artifact: string;
}) {
  for (const segment of [input.version, input.platform, input.arch, input.artifact]) {
    if (!segment || segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
      throw new ApiError("NOT_FOUND", "Artifact was not found.", 404);
    }
  }

  const resolvedRoot = path.resolve(input.artifactRoot);
  const filePath = path.resolve(resolvedRoot, input.version, input.platform, input.arch, input.artifact);
  if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ApiError("NOT_FOUND", "Artifact was not found.", 404);
  }

  return filePath;
}

function createDownloadHandler(artifactRoot: string): RouteHandler {
  return async (request): Promise<RouteResponse> => {
    const filePath = resolveArtifactPath({
      artifactRoot,
      version: request.params.version ?? "",
      platform: request.params.platform ?? "",
      arch: request.params.arch ?? "",
      artifact: request.params.artifact ?? ""
    });

    try {
      await access(filePath);
    } catch {
      throw new ApiError("NOT_FOUND", "Artifact was not found.", 404);
    }

    const fileName = path.basename(filePath);
    const bytes = await readFile(filePath);
    return {
      status: 200,
      bytes,
      contentType: contentTypeForArtifact(fileName),
      fileName
    };
  };
}

export function registerDeviceBridgeDownloadRoutes(
  router: {
    get(path: string, handler: RouteHandler): void;
  },
  input: {
    artifactRoot?: string;
    toolArtifactRoot?: string;
  }
) {
  if (input.artifactRoot) {
    router.get(
      "/downloads/device-bridge/:version/:platform/:arch/:artifact",
      createDownloadHandler(input.artifactRoot)
    );
  }

  if (input.toolArtifactRoot) {
    router.get(
      "/downloads/device-bridge-tools/:version/:platform/:arch/:artifact",
      createDownloadHandler(input.toolArtifactRoot)
    );
  }
}
