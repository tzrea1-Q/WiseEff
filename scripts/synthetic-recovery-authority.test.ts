import { beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openSyntheticRecoveryAuthority, type SyntheticRecoveryAuthorityInput } from "./synthetic-recovery-authority";

const io = vi.hoisted(() => ({ docker: vi.fn(), database: vi.fn(), host: false, loaded: undefined as unknown }));
vi.mock("./isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: io.docker }));
vi.mock("../server/shared/database/client", async original => ({
  ...await original<typeof import("../server/shared/database/client")>(), createPostgresDatabase: io.database,
}));
vi.mock("../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff", async original => {
  const actual = await original<typeof import("../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff")>();
  return { ...actual, assertHostOperationLockForJournal: (...args: Parameters<typeof actual.assertHostOperationLockForJournal>) =>
    io.host ? Promise.resolve() : actual.assertHostOperationLockForJournal(...args) };
});
vi.mock("../ops/self-hosted/scripts/parameter-catalog-upgrade/journal", async original => {
  const actual = await original<typeof import("../ops/self-hosted/scripts/parameter-catalog-upgrade/journal")>();
  return { ...actual, loadUpgradeJournal: (...args: Parameters<typeof actual.loadUpgradeJournal>) =>
    io.loaded ?? actual.loadUpgradeJournal(...args) };
});
beforeEach(() => { vi.clearAllMocks(); io.host = false; io.loaded = undefined; });
const input = () => ({ runId: "a".repeat(24), operationRoot: "/private/synthetic", privateDirectory: "/private/synthetic/authority",
  journal: { journalPath: "/private/synthetic/journal.json", record: { runId: "a".repeat(24) } },
  lock: { assertHeld: async () => {} }, capture: { runId: "a".repeat(24), source: { postgresIdentity: "2".repeat(64) } },
  target: { postgresIdentity: "3".repeat(64) },
  auth: { expectedDaemonId: "private-daemon", containerId: "1".repeat(64), sourceContainerId: "2".repeat(64),
    targetContainerId: "3".repeat(64), imageId: `sha256:${"4".repeat(64)}`, networkId: "5".repeat(64),
    adminUrl: "postgres://postgres:private-test-secret@127.0.0.1:5432/postgres", registeredContainerIds: ["1".repeat(64), "2".repeat(64), "3".repeat(64)] },
}) as unknown as SyntheticRecoveryAuthorityInput;

it.each(["source", "target"])("rejects reuse of the %s container before connecting or assigning authority", async kind => {
  const value = input();
  value.auth.containerId = kind === "source" ? value.auth.sourceContainerId : value.auth.targetContainerId;
  await expect(openSyntheticRecoveryAuthority(value)).rejects.toThrow("synthetic-recovery-authority-unavailable");
  expect(io.docker).not.toHaveBeenCalled(); expect(io.database).not.toHaveBeenCalled();
});

it.each(["foreign-volume", "unregistered-network-member", "foreign-network-member"])("rejects %s before any database connection", async fault => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synthetic-authority-test-")));
  const value = input(); value.operationRoot = root; value.privateDirectory = path.join(root, "authority");
  await mkdir(value.privateDirectory, { mode: 0o700 });
  value.journal.journalPath = path.join(root, "journal.json");
  const record = { runId: value.runId, journalDigest: "fixed", entries: [{ recoveryCapture: { outcome: "committed", capture: value.capture } }] };
  Object.assign(value.journal, { record }); io.loaded = { ok: true, value: { record } }; io.host = true;
  const mount = { Type: "volume", Name: "foreign-volume", Source: "/private/foreign-volume", Destination: "/var/lib/postgresql/data", RW: true };
  const extra = "6".repeat(64);
  if (fault === "foreign-network-member") value.auth.registeredContainerIds.push(extra);
  io.docker.mockReturnValue({ daemonId: value.auth.expectedDaemonId,
    assertOwned: (id: string) => {
      if (id === extra) throw new Error("foreign-owned-label-mismatch");
      return { Image: value.auth.imageId, State: { Running: true }, HostConfig: { Privileged: false }, Mounts: [mount],
        NetworkSettings: { Networks: { isolated: { NetworkID: value.auth.networkId } }, Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] } } };
    },
    command: (args: string[]) => Buffer.from(args[0] === "network" ? JSON.stringify([{ Id: value.auth.networkId, Labels: { "wiseeff.synthetic-recovery-run": value.runId },
      Containers: fault === "foreign-volume" ? {} : { [extra]: {} }, Driver: "bridge", Created: "2026-09-01T00:00:00Z" }])
      : args[0] === "volume" ? JSON.stringify([{ Name: mount.Name, Mountpoint: mount.Source, Driver: "local", Scope: "local", Options: {},
        Labels: fault === "foreign-volume" ? {} : { "wiseeff.synthetic-recovery-run": value.runId }, CreatedAt: "2026-09-01T00:00:00Z" }])
      : value.auth.containerId),
  });
  try {
    await expect(openSyntheticRecoveryAuthority(value)).rejects.toThrow("synthetic-recovery-authority-unavailable");
    expect(io.database.mock.calls.length === 0).toBe(true);
  } finally { await rm(root, { recursive: true }); }
});
it("does not accept a caller's successful assertHeld callback as an issued host lock", async () => {
  await expect(openSyntheticRecoveryAuthority(input())).rejects.toThrow("synthetic-recovery-authority-unavailable");
  expect(io.docker).not.toHaveBeenCalled(); expect(io.database).not.toHaveBeenCalled();
});
it("redacts a private input accessor failure before selecting borrowed resources", async () => {
  const value = input();
  Object.defineProperty(value, "journal", { get() { throw new Error("private-custodian-credential"); } });
  await expect(openSyntheticRecoveryAuthority(value)).rejects.toThrow("synthetic-recovery-authority-unavailable");
  expect(io.docker).not.toHaveBeenCalled(); expect(io.database).not.toHaveBeenCalled();
});
it.each(["run", "directory", "container"])("rejects invalid %s scope without ambient fallback", async kind => {
  const value = input();
  if (kind === "run") value.runId = "another-run";
  if (kind === "directory") value.privateDirectory = "/private/unrelated/authority";
  if (kind === "container") value.auth.containerId = "friendly-name";
  let observed: unknown;
  try { await openSyntheticRecoveryAuthority(value); } catch (error) { observed = error; }
  expect(observed).toMatchObject({ message: "synthetic-recovery-authority-unavailable" });
  expect(String(observed).includes("private-test-secret")).toBe(false);
  expect(io.docker).not.toHaveBeenCalled(); expect(io.database).not.toHaveBeenCalled();
});
