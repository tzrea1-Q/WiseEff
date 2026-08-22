import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV =
  "WISEEFF_ACCEPTANCE_NESTED_RUNTIME_MANIFEST";
export const OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV =
  "WISEEFF_ACCEPTANCE_NESTED_RUNTIME_ID";

export type NestedRuntimeState = "running" | "cleaned" | "failed-cleaned" | "cleanup-failed";

type NestedRuntimeRecord = {
  id: string;
  state: NestedRuntimeState;
  databaseName: string;
  markerPurpose: string;
  migrationRunId: string;
  objectStoreRoot: string;
  apiUrl: string;
  frontendUrl: string;
  apiPid: number;
  frontendPid: number;
  startedAt: string;
  completedAt?: string;
};

type NestedRuntimeManifest = {
  version: 1;
  kind: "wiseeff-gate0-nested-runtime-manifest";
  parentRunId: string;
  sourceCommit: string;
  children: NestedRuntimeRecord[];
  updatedAt: string;
};

export function initializeNestedRuntimeManifest(
  manifestPath: string,
  identity: { parentRunId: string; sourceCommit: string },
) {
  if (!path.isAbsolute(manifestPath)) throw new Error("Nested runtime manifest path must be absolute.");
  if (!/^[a-f0-9]{40}$/u.test(identity.sourceCommit)) {
    throw new Error("Nested runtime manifest requires an exact source commit.");
  }
  const manifest: NestedRuntimeManifest = {
    version: 1,
    kind: "wiseeff-gate0-nested-runtime-manifest",
    parentRunId: identity.parentRunId,
    sourceCommit: identity.sourceCommit,
    children: [],
    updatedAt: new Date().toISOString(),
  };
  writeManifest(manifestPath, manifest, "wx");
  return manifestPath;
}

export function recordNestedRuntimeStart(
  manifestPath: string,
  child: Omit<NestedRuntimeRecord, "state" | "startedAt" | "completedAt">,
) {
  const manifest = readManifest(manifestPath);
  if (manifest.children.some((entry) => entry.id === child.id)) {
    throw new Error(`Nested runtime ${child.id} is already registered.`);
  }
  if (!/^wiseeff_acceptance_disposable_[a-z0-9_]+$/u.test(child.databaseName)) {
    throw new Error(`Nested runtime database name is unsafe: ${child.databaseName}`);
  }
  for (const [label, pid] of [["api", child.apiPid], ["frontend", child.frontendPid]] as const) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Nested ${label} PID must be a positive integer.`);
  }
  manifest.children.push({
    ...child,
    state: "running",
    startedAt: new Date().toISOString(),
  });
  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifestPath, manifest);
}

export function recordNestedRuntimeFinish(
  manifestPath: string,
  childId: string,
  state: Exclude<NestedRuntimeState, "running">,
) {
  const manifest = readManifest(manifestPath);
  const child = manifest.children.find((entry) => entry.id === childId);
  if (!child) throw new Error(`Nested runtime ${childId} is not registered.`);
  if (child.state !== "running") throw new Error(`Nested runtime ${childId} is already finalized.`);
  child.state = state;
  child.completedAt = new Date().toISOString();
  manifest.updatedAt = child.completedAt;
  writeManifest(manifestPath, manifest);
}

function readManifest(manifestPath: string) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as NestedRuntimeManifest;
  if (
    manifest.version !== 1 ||
    manifest.kind !== "wiseeff-gate0-nested-runtime-manifest" ||
    !Array.isArray(manifest.children)
  ) {
    throw new Error("Nested runtime manifest identity is invalid.");
  }
  return manifest;
}

function writeManifest(manifestPath: string, manifest: NestedRuntimeManifest, flag: "w" | "wx" = "w") {
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\//iu.test(serialized) || /auth.?secret|authorization|bearer/iu.test(serialized)) {
    throw new Error("Nested runtime manifest must not contain credentials.");
  }
  writeFileSync(manifestPath, serialized, { encoding: "utf8", flag });
}
