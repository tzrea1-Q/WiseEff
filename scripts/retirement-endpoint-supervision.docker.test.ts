import { spawn } from "node:child_process";
import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "./upgrade-test-target";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";
import { superviseComponentProcess } from "./run-upgrade-component-tests";

// The actual runner, not this child, creates and removes the entire topology.
// This case proves process-group termination using its verified parent receipt.
// Parent timeout/cleanup itself is a separate outer-runner fault experiment.
it("terminates a TERM-resistant group while the supervising parent retains endpoint ownership", async () => {
  assertOwnedUpgradeTestTarget();
  const file = openSync(process.env.UPG_TEST_TARGET_RECEIPT!, constants.O_RDONLY | constants.O_NOFOLLOW);
  let receipt;
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > 16384) throw new Error("owned-retirement-receipt-invalid");
    receipt = JSON.parse(readFileSync(file, "utf8"));
  } finally { closeSync(file); }
  const docker = createIsolatedUpgradeDocker();
  const endpoints = receipt.retirementEndpoints;
  if (receipt.daemonId !== docker.daemonId || endpoints?.label !== "wiseeff.controlled-recovery-run" ||
      !/^[a-f0-9]{24}$/.test(endpoints.ownerRunId) || !/^[a-f0-9]{64}$/.test(endpoints.networkId) ||
      !/^sha256:[a-f0-9]{64}$/.test(endpoints.imageId)) throw new Error("owned-retirement-receipt-invalid");
  const ids = [endpoints.firstId, endpoints.secondId, endpoints.probeId, endpoints.hostnameProbeId];
  if (new Set(ids).size !== 4) throw new Error("owned-retirement-receipt-invalid");
  const verify = () => {
    const network = JSON.parse(docker.command(["network", "inspect", endpoints.networkId]).toString())[0];
    if (network.Id !== endpoints.networkId || network.Labels?.[endpoints.label] !== endpoints.ownerRunId) throw new Error("owned-retirement-network-mismatch");
    for (const id of ids) {
      const actual = docker.assertOwned(id, endpoints.label, endpoints.ownerRunId);
      if (actual.Image !== endpoints.imageId || Object.keys(actual.NetworkSettings.Networks).length !== 1 ||
          !Object.values(actual.NetworkSettings.Networks).some((value: any) => value.NetworkID === endpoints.networkId)) throw new Error("owned-retirement-container-mismatch");
    }
  };
  verify();
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); process.stdout.write('ready'); setInterval(()=>{},5);"],
    { detached: true, stdio: ["ignore", "pipe", "pipe"], env: {} });
  const result = await superviseComponentProcess(child, { deadlineMs: 500, graceMs: 30, outputBytes: 1024 }).wait;
  expect(result.exitCode).toBe(1);
  expect(result.output).toBe("ready");
  expect(child.signalCode).toBe("SIGKILL");
  verify();
});
