import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import * as handoff from "./handoff";
import { canonicalJson, sha256Prefixed } from "./journal";
import * as runtime from "../../../../server/shared/database/runtimeConnection";
import { observeRuntimeRoles, openRuntimeRoleSource } from "./runtimeRoleSource";

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "runtime-role-source-")));
  const names = ["main", "api", "worker", "management"];
  const bodies = [`WISEEFF_API_ENV_FILE=${directory}/api\nWISEEFF_WORKER_ENV_FILE=${directory}/worker\nWISEEFF_MANAGEMENT_ENV_FILE=${directory}/management\n`,
    "NODE_ENV=production\nDATABASE_URL=postgres://private-api\n", "NODE_ENV=production\nDATABASE_URL=postgres://private-worker\n", "DATABASE_URL=postgres://private-manager\n"];
  const bindings = [];
  for (let index = 0; index < names.length; index++) {
    const filename = path.join(directory, names[index]);
    await writeFile(filename, bodies[index], { mode: 0o600, flag: "wx" });
    const stat = await lstat(filename);
    bindings.push({ path: filename, device: String(stat.dev), inode: String(stat.ino), digest: `sha256:${createHash("sha256").update(bodies[index]).digest("hex")}` });
  }
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { runId: "roles", lockRoot: directory,
    journalPath: path.join(directory, "journal.json"), privateConfigPath: bindings[0].path },
  observation: { privateConfigurations: { main: bindings[0], runtime: {
    WISEEFF_API_ENV_FILE: bindings[1], WISEEFF_WORKER_ENV_FILE: bindings[2], WISEEFF_MANAGEMENT_ENV_FILE: bindings[3],
  } } } };
  const plan = { ...body, digest: sha256Prefixed(canonicalJson(body)) } as unknown as handoff.HandoffPlan;
  return { directory, plan };
}

it("requires an actual issued host lock before opening private configuration files", async () => {
  const f = await fixture();
  try {
    await expect(handoff.openHandoffRuntimeConfigurationLease(f.plan, f.plan.digest, { async assertHeld() {} }))
      .rejects.toThrow("handoff-lock-not-issued-for-journal");
  } finally { await rm(f.directory, { recursive: true }); }
});

it("rejects caller-created role observations and source locks without a connection", async () => {
  await expect(observeRuntimeRoles({ close: async () => undefined } as never)).rejects.toThrow("NOT-ISSUED");
  const f = await fixture();
  try {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock: { async assertHeld() {} } }))
      .rejects.toThrow("handoff-lock-not-issued-for-journal");
  } finally { await rm(f.directory, { recursive: true }); }
});

it("keeps governance-purpose identity separate from the application identity check", async () => {
  const db = { query: async () => ({ rows: [{ same_identity: true, privileged_roles: 0, management_roles: 0, owned_objects: 0, governance_roles: 1 }] }) };
  await expect(runtime.assertRuntimeLoginIdentity(db as never, "application"))
    .rejects.toMatchObject({ code: "PCAT-RUNTIME-GOVERNANCE-CAPABILITY-IN-APPLICATION-POOL" });
  expect((await runtime.assertRuntimeLoginIdentity(db as never, "catalog-governance-command")).governance_roles).toBe(1);
});

it.each(["replacement", "bytes", "mode"])("retains the original configuration FD and rejects %s drift", async change => {
  const f = await fixture();
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const lease = await handoff.openHandoffRuntimeConfigurationLease(f.plan, f.plan.digest, lock);
      try {
        expect((await lease.read()).api.NODE_ENV).toBe("production");
        const filename = path.join(f.directory, "api");
        if (change === "replacement") { await rename(filename, `${filename}.original`); await writeFile(filename, "NODE_ENV=production\n", { mode: 0o600 }); }
        if (change === "bytes") await writeFile(filename, "NODE_ENV=production\nDATABASE_URL=changed\n");
        if (change === "mode") await chmod(filename, 0o644);
        await expect(lease.read()).rejects.toThrow("handoff-runtime-config-drift");
      } finally { await lease.close(); }
      await expect(lease.read()).rejects.toThrow("handoff-runtime-config-closed");
    });
  } finally { await rm(f.directory, { recursive: true }); }
});

it("applies the same privileged identity refusal without issuing startup admission", async () => {
  const query = async () => ({ rows: [{ same_identity: true, privileged_roles: 1, management_roles: 0, owned_objects: 0, governance_roles: 0 }] });
  await expect(runtime.assertRuntimeLoginIdentity({ query } as never, "application"))
    .rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
});
