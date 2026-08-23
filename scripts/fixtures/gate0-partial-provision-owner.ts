import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { initializeNestedRuntimeManifest } from "../../e2e/acceptance/helpers/nestedRuntimeManifest";
import {
  initializeGate0ProvisioningRun,
  recordGate0ProvisioningProcessLaunching,
  recordGate0ProvisioningProcessStarted,
} from "../gate0-provisioning-journal";
import { spawnGate0SupervisedProcess } from "../gate0-process-launch-supervisor";
import { readProcessStartIdentity } from "../process-start-identity";

const [runRoot, runId, sourceCommit] = process.argv.slice(2);
if (!runRoot || !runId || !sourceCommit) throw new Error("Partial provision owner fixture arguments are missing.");
const ownerProcessIdentity = readProcessStartIdentity(process.pid);
if (!ownerProcessIdentity) throw new Error("Partial provision owner fixture cannot capture its identity.");
const objectStoreRoot = path.join(runRoot, "object-store");
const nestedRuntimeManifest = path.join(runRoot, "nested-runtime-manifest.json");
const journalPath = initializeGate0ProvisioningRun(runRoot, {
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
    databaseName: "wiseeff_acceptance_full_partial_fixture",
    runRoot,
    objectStoreRoot,
    nestedRuntimeManifest,
  },
});
mkdirSync(objectStoreRoot);
initializeNestedRuntimeManifest(nestedRuntimeManifest, { parentRunId: runId, sourceCommit });
recordGate0ProvisioningProcessLaunching(journalPath, "api", "partial fixture API");
const api = spawnGate0SupervisedProcess({
  supervision: { runRoot, runId, sourceCommit, label: `root:${runId}:api` },
  cwd: process.cwd(),
  command: process.execPath,
  args: ["-e", "setInterval(() => {}, 1000)"],
  env: process.env,
  stdio: "ignore",
});
if (!api.pid) throw new Error("Partial provision owner fixture API has no PID.");
const apiIdentity = readProcessStartIdentity(api.pid);
if (!apiIdentity) throw new Error("Partial provision owner fixture API identity is missing.");
recordGate0ProvisioningProcessStarted(journalPath, "api", "partial fixture API", api.pid, apiIdentity);
process.stdout.write(`${JSON.stringify({ apiPid: api.pid })}\n`);
await new Promise(() => undefined);
