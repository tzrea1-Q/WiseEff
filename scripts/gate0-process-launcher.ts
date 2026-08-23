import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  claimGate0OwnedProcessLaunch,
  gate0LaunchControlEnvironment,
} from "./gate0-process-launch-supervisor";

const control = gate0LaunchControlEnvironment();
const claim = claimGate0OwnedProcessLaunch(control.recordPath);
while (!existsSync(control.ackPath)) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
if (readFileSync(control.ackPath, "utf8").trim() !== claim.launchId) {
  throw new Error("Gate0 process launcher acknowledgement identity is invalid.");
}
// The durable claim was published by this exact process before ACK. Remove the
// ACK immediately after validating its token; a second OS identity probe here
// can starve the symmetric parent deadline under process-table pressure. The
// parent binds this durable claim to the exact ChildProcess PID before GO.
unlinkSync(control.ackPath);
while (!existsSync(control.goPath)) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
if (readFileSync(control.goPath, "utf8").trim() !== claim.launchId) {
  throw new Error("Gate0 process launcher execution identity is invalid.");
}
unlinkSync(control.goPath);
for (const key of Object.keys(process.env)) {
  if (key.startsWith("WISEEFF_GATE0_LAUNCH_")) delete process.env[key];
}
if (control.nodeEntry) {
  process.argv = [process.execPath, control.nodeEntry.entry, ...control.nodeEntry.args];
  await import(pathToFileURL(control.nodeEntry.entry).href);
  await new Promise(() => undefined);
}
const child = spawn(control.command, control.args, {
  cwd: control.cwd,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("WISEEFF_GATE0_LAUNCH_"))),
  stdio: "inherit",
  detached: false,
  shell: control.shell,
});
const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
process.exitCode = exitCode;
