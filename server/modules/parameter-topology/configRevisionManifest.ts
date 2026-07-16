/**
 * Config-set manifest persistence, path normalization, and fail-closed entry/base checks.
 */

import posixPath from "node:path/posix";

import type { ConfigRevisionManifest, ConfigRevisionManifestMember, ConfigRevisionManifestState, ConfigRevisionStatus } from "./types";

export type PersistedConfigRevisionManifest = {
  entryFile: string;
  includeSearchPaths: string[];
  overlayOrder: string[];
};

export type ManifestValidationFailure = {
  code:
    | "missing-base"
    | "missing-entry-file"
    | "path-escape"
    | "empty-manifest"
    | "manifest-needs-review";
  message: string;
};

export const MANIFEST_NEEDS_REVIEW_FAILURE_CODE = "manifest-needs-review" as const;

/** Fail-closed when historical backfill left manifest fields operator-reviewable. */
export function assertManifestStateReady(
  manifestState: ConfigRevisionManifestState | undefined,
): ManifestValidationFailure | null {
  if (manifestState === "needs_review") {
    return {
      code: MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
      message:
        "Config revision manifest requires operator review before validate, edit, release, or writeback.",
    };
  }
  return null;
}

/** Structural DTS path segments that escape the logical manifest workspace. */
export function isManifestPathEscape(normalized: string): boolean {
  return (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith("/")
  );
}

export function normalizeManifestLogicalPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = posixPath.normalize(trimmed);
  if (isManifestPathEscape(normalized)) return null;
  return normalized;
}

export function normalizeIncludeSearchPaths(paths: readonly string[]): string[] | ManifestValidationFailure {
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = posixPath.normalize(trimmed);
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
      return {
        code: "path-escape",
        message: `Include search path escapes the manifest workspace: ${raw}`,
      };
    }
    // Absolute search roots are rejected — logical workspace paths only.
    if (normalized.startsWith("/")) {
      return {
        code: "path-escape",
        message: `Include search path must be workspace-relative: ${raw}`,
      };
    }
    out.push(normalized === "" ? "." : normalized);
  }
  return out.length > 0 ? out : ["."];
}

/**
 * Fail-closed: require an explicit role=base member and a matching entryFile.
 * Never pick an arbitrary first file as the entry.
 */
export function assertManifestEntryAndBase(
  manifest: Pick<ConfigRevisionManifest, "entryFile" | "members">,
): ManifestValidationFailure | null {
  if (manifest.members.length === 0) {
    return { code: "empty-manifest", message: "Config revision manifest has no members." };
  }

  const entryFile = normalizeManifestLogicalPath(manifest.entryFile);
  if (!entryFile) {
    return {
      code: "missing-entry-file",
      message: "Config revision manifest is missing a safe entryFile.",
    };
  }

  const baseMembers = manifest.members.filter((member) => member.role === "base");
  if (baseMembers.length === 0) {
    return {
      code: "missing-base",
      message: "Config revision manifest has no member with role=base.",
    };
  }

  const entryMember = manifest.members.find((member) => member.fileName === entryFile);
  if (!entryMember) {
    return {
      code: "missing-entry-file",
      message: `entryFile ${entryFile} is not present in manifest members.`,
    };
  }

  if (entryMember.role !== "base") {
    return {
      code: "missing-base",
      message: `entryFile ${entryFile} must have role=base (found role=${entryMember.role}).`,
    };
  }

  return null;
}

export function normalizePersistedManifest(input: {
  entryFile: string;
  includeSearchPaths: readonly string[];
  overlayOrder: readonly string[];
  members: ConfigRevisionManifestMember[];
}): { ok: true; manifest: PersistedConfigRevisionManifest } | { ok: false; failure: ManifestValidationFailure } {
  const entryCheck = assertManifestEntryAndBase({
    entryFile: input.entryFile,
    members: input.members,
  });
  if (entryCheck) {
    return { ok: false, failure: entryCheck };
  }

  const entryFile = normalizeManifestLogicalPath(input.entryFile)!;
  const includeSearchPaths = normalizeIncludeSearchPaths(input.includeSearchPaths);
  if (!Array.isArray(includeSearchPaths)) {
    return { ok: false, failure: includeSearchPaths };
  }

  const overlayOrder: string[] = [];
  for (const raw of input.overlayOrder) {
    const normalized = normalizeManifestLogicalPath(raw);
    if (!normalized) {
      return {
        ok: false,
        failure: {
          code: "path-escape",
          message: `Overlay path escapes the manifest workspace: ${raw}`,
        },
      };
    }
    overlayOrder.push(normalized);
  }

  return {
    ok: true,
    manifest: { entryFile, includeSearchPaths, overlayOrder },
  };
}

/**
 * Clear status after a failed validation run. Never leave `validated`.
 */
export function clearStatusAfterValidationFailure(
  current: ConfigRevisionStatus,
  failureCode: string,
): ConfigRevisionStatus {
  if (failureCode === "open-mapping") {
    return "needs_mapping";
  }
  if (
    failureCode === "toolchain-unavailable" ||
    failureCode === "version-mismatch" ||
    failureCode === "compile-failed" ||
    failureCode === "schema-failed" ||
    failureCode === "resolve-failed"
  ) {
    return "invalid";
  }

  if (current === "validated" || current === "compiled" || current === "pending_approval") {
    return "validation_failed";
  }

  if (current === "needs_mapping" || current === "invalid" || current === "validation_failed") {
    return current;
  }

  // resolved / draft / resolving: keep resolved as diagnosable non-publishable
  return current === "draft" || current === "resolving" ? "resolved" : current;
}
