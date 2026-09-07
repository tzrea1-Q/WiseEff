import { beforeEach, expect, it, vi } from "vitest";
import { openSyntheticRecoveryAuthority, type SyntheticRecoveryAuthorityInput } from "./synthetic-recovery-authority";

const io = vi.hoisted(() => ({ docker: vi.fn(), database: vi.fn() }));
vi.mock("./isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: io.docker }));
vi.mock("../server/shared/database/client", async original => ({
  ...await original<typeof import("../server/shared/database/client")>(), createPostgresDatabase: io.database,
}));
beforeEach(() => { vi.clearAllMocks(); });
const input = () => ({ runId: "a".repeat(24), operationRoot: "/private/synthetic", privateDirectory: "/private/synthetic/authority",
  journal: { journalPath: "/private/synthetic/journal.json", record: { runId: "a".repeat(24) } },
  lock: { assertHeld: async () => {} }, capture: { runId: "a".repeat(24), source: { postgresIdentity: "2".repeat(64) } },
  target: { postgresIdentity: "3".repeat(64) },
  auth: { expectedDaemonId: "private-daemon", containerId: "1".repeat(64), sourceContainerId: "2".repeat(64),
    targetContainerId: "3".repeat(64), imageId: `sha256:${"4".repeat(64)}`, networkId: "5".repeat(64),
    adminUrl: "postgres://postgres:private-test-secret@127.0.0.1:5432/postgres" },
}) as unknown as SyntheticRecoveryAuthorityInput;

it.each(["source", "target"])("rejects reuse of the %s container before connecting or assigning authority", async kind => {
  const value = input();
  value.auth.containerId = kind === "source" ? value.auth.sourceContainerId : value.auth.targetContainerId;
  await expect(openSyntheticRecoveryAuthority(value)).rejects.toThrow("synthetic-recovery-authority-unavailable");
  expect(io.docker).not.toHaveBeenCalled(); expect(io.database).not.toHaveBeenCalled();
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
