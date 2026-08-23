import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const [runRootInput, runId, sourceCommit] = process.argv.slice(2);
if (!runRootInput || !runId || !sourceCommit) {
  throw new Error("Gate0 provisioning stage fixture requires runRoot, runId, and sourceCommit.");
}
const runRoot = path.resolve(runRootInput);
const originalRename = fs.renameSync.bind(fs);
fs.renameSync = ((oldPath, newPath) => {
  if (path.resolve(String(newPath)) === runRoot) {
    process.stdout.write(`${JSON.stringify({ state: "staged" })}\n`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
  }
  return originalRename(oldPath, newPath);
}) as typeof fs.renameSync;
syncBuiltinESMExports();

const { readProcessStartIdentity } = await import("../process-start-identity");
const { initializeGate0ProvisioningRun } = await import("../gate0-provisioning-journal");
const ownerProcessIdentity = readProcessStartIdentity(process.pid);
if (!ownerProcessIdentity) throw new Error("Gate0 provisioning stage fixture lacks an owner identity.");

initializeGate0ProvisioningRun(runRoot, {
  run: {
    id: runId,
    sourceCommit,
    worktreeRoot: process.cwd(),
    ownerPid: process.pid,
    ownerProcessIdentity,
    createdAt: new Date().toISOString(),
    state: "provisioning",
  },
  resources: {
    databaseName: `wiseeff_acceptance_${runId.replace(/-/gu, "_")}`,
    runRoot,
    objectStoreRoot: path.join(runRoot, "object-store"),
    nestedRuntimeManifest: path.join(runRoot, "nested-runtime-manifest.json"),
  },
});
