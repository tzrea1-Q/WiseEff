import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ApiError } from "../../shared/http/errors";
import type { DeviceBridgePlatform } from "./types";

const manifestItemSchema = z.object({
  platform: z.enum(["windows", "darwin", "linux"]),
  arch: z.string().min(1),
  version: z.string().min(1),
  artifact: z.string().min(1),
  sha256: z.string().min(1).optional(),
  downloadUrl: z.string().min(1).optional()
});

const manifestFileSchema = z.object({
  recommendedVersion: z.string().min(1),
  minCompatibleVersion: z.string().min(1),
  items: z.array(manifestItemSchema).min(1)
});

export type BridgeReleaseItem = {
  platform: DeviceBridgePlatform;
  arch: string;
  version: string;
  downloadUrl: string;
  sha256?: string;
};

export type BridgeReleaseManifest = {
  recommendedVersion: string;
  minCompatibleVersion: string;
  items: BridgeReleaseItem[];
};

const platformOrder: Record<DeviceBridgePlatform, number> = {
  windows: 0,
  darwin: 1,
  linux: 2
};

function buildDownloadUrl(input: { version: string; platform: DeviceBridgePlatform; arch: string; artifact: string }) {
  return `/downloads/device-bridge/${input.version}/${input.platform}/${input.arch}/${input.artifact}`;
}

function normalizeDownloadUrl(item: z.infer<typeof manifestItemSchema>) {
  if (item.downloadUrl?.startsWith("/downloads/device-bridge/")) {
    return item.downloadUrl;
  }

  return buildDownloadUrl({
    version: item.version,
    platform: item.platform,
    arch: item.arch,
    artifact: item.artifact
  });
}

function sortItemsWindowsFirst(items: BridgeReleaseItem[]) {
  return [...items].sort((left, right) => {
    const platformDelta = platformOrder[left.platform] - platformOrder[right.platform];
    if (platformDelta !== 0) {
      return platformDelta;
    }

    return left.arch.localeCompare(right.arch);
  });
}

function compareSemver(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

export async function loadBridgeReleaseManifest(manifestPath: string): Promise<BridgeReleaseManifest> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new ApiError("NOT_FOUND", "Bridge release manifest was not found.", 404);
  }

  const parsed = manifestFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ApiError("INTERNAL_ERROR", "Bridge release manifest is invalid.", 500, {
      issues: parsed.error.issues
    });
  }

  const items = sortItemsWindowsFirst(
    parsed.data.items.map((item) => ({
      platform: item.platform,
      arch: item.arch,
      version: item.version,
      downloadUrl: normalizeDownloadUrl(item),
      ...(item.sha256 ? { sha256: item.sha256 } : {})
    }))
  );

  return {
    recommendedVersion: parsed.data.recommendedVersion,
    minCompatibleVersion: parsed.data.minCompatibleVersion,
    items
  };
}

export async function loadLatestBridgeReleaseManifest(artifactRoot: string): Promise<BridgeReleaseManifest> {
  const resolvedRoot = path.resolve(artifactRoot);
  let entries: string[];
  try {
    entries = await readdir(resolvedRoot);
  } catch {
    throw new ApiError("NOT_FOUND", "Bridge release artifacts were not found.", 404);
  }

  const versionDirs = (
    await Promise.all(
      entries.map(async (entry) => {
        const manifestPath = path.join(resolvedRoot, entry, "manifest.json");
        try {
          await readFile(manifestPath, "utf8");
          return entry;
        } catch {
          return null;
        }
      })
    )
  ).filter((entry): entry is string => entry !== null);

  if (versionDirs.length === 0) {
    throw new ApiError("NOT_FOUND", "Bridge release manifest was not found.", 404);
  }

  versionDirs.sort(compareSemver);
  const latestVersion = versionDirs[versionDirs.length - 1];
  return loadBridgeReleaseManifest(path.join(resolvedRoot, latestVersion, "manifest.json"));
}
