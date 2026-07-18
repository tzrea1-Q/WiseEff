import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type EvidenceRunKind = "full" | "focused";

export type EvidenceRunContext = {
  root: string;
  runId: string;
  sourceCommit: string;
  runKind: EvidenceRunKind;
  runRoot: string;
  recordsRoot: string;
  artifactsRoot: string;
};

export type FullEvidenceRunManifest = EvidenceRunContext & {
  version: 1;
  runKind: "full";
  completedAt: string;
};

type EvidenceRunEnv = Record<string, string | undefined>;

export const defaultEvidenceRunsRoot = "test-results/acceptance-evidence-runs";
export const latestFullEvidenceManifestName = "latest-full.json";

export function resolveEvidenceRunContext(env: EvidenceRunEnv = process.env): EvidenceRunContext {
  const root = env.WISEEFF_ACCEPTANCE_EVIDENCE_ROOT?.trim() || defaultEvidenceRunsRoot;
  const runId = safePathSegment(
    env.WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID?.trim() || `focused-${process.pid}`,
    "run id"
  );
  const sourceCommit = safePathSegment(
    env.WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT?.trim() || "unpublished",
    "source commit"
  );
  const runKind = env.WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND === "full" ? "full" : "focused";
  const runRoot = join(root, "runs", sourceCommit, runId);

  return {
    root,
    runId,
    sourceCommit,
    runKind,
    runRoot,
    recordsRoot: join(runRoot, "records"),
    artifactsRoot: join(runRoot, "artifacts")
  };
}

export function prepareEvidenceRun(context: EvidenceRunContext) {
  rmSync(context.runRoot, { recursive: true, force: true });
  mkdirSync(context.recordsRoot, { recursive: true });
  mkdirSync(context.artifactsRoot, { recursive: true });
}

export function evidenceRunEnv(context: EvidenceRunContext): EvidenceRunEnv {
  return {
    WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: context.root,
    WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: context.runId,
    WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: context.sourceCommit,
    WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: context.runKind
  };
}

export function publishLatestFullEvidenceRun(context: EvidenceRunContext, completedAt = new Date().toISOString()) {
  if (context.runKind !== "full") {
    throw new Error("Only a completed full evidence run may be published as latest-full.");
  }

  const manifest: FullEvidenceRunManifest = {
    version: 1,
    ...context,
    runKind: "full",
    completedAt
  };
  mkdirSync(context.root, { recursive: true });
  const manifestPath = join(context.root, latestFullEvidenceManifestName);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, manifestPath);
  return manifest;
}

export function readLatestFullEvidenceRun(root = defaultEvidenceRunsRoot): FullEvidenceRunManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, latestFullEvidenceManifestName), "utf8")) as Partial<FullEvidenceRunManifest>;
    if (
      parsed.version !== 1 ||
      parsed.runKind !== "full" ||
      !parsed.runId ||
      !parsed.sourceCommit ||
      !parsed.runRoot ||
      !parsed.recordsRoot ||
      !parsed.artifactsRoot ||
      !parsed.completedAt
    ) {
      throw new Error("Latest full evidence manifest is incomplete.");
    }
    safePathSegment(parsed.runId, "run id");
    safePathSegment(parsed.sourceCommit, "source commit");
    return parsed as FullEvidenceRunManifest;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function safePathSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Evidence ${label} contains unsafe path characters.`);
  }
  return value;
}
