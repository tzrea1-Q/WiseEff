import { expect, it, vi } from "vitest";

const docker = vi.hoisted(() => vi.fn(() => { throw new Error("unexpected-docker-access"); }));
vi.mock("./isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: docker }));
vi.mock("node:fs/promises", async () => ({
  ...await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
  access: async () => { throw Object.assign(new Error("missing-component"), { code: "ENOENT" }); },
}));
import { runUpgradeComponentTests } from "./run-upgrade-component-tests";

it("refuses an incomplete projection component before observing or creating Docker resources", async () => {
  await expect(runUpgradeComponentTests([
    "--expected-daemon-id", "owned-placeholder", "--suite", "read-projections-pg16",
  ])).resolves.toEqual({ exitCode: 2, reason: "owned-read-projections-component-unavailable" });
  expect(docker).not.toHaveBeenCalled();
});
