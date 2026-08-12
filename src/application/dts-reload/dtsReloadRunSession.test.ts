import { describe, expect, it, vi } from "vitest";

import type { DtsReloadCandidate, DtsReloadResidue, DtsReloadRun } from "@/domain/dtsReload/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import {
  createDtsReloadRunSession,
  type DtsReloadRunSessionOptions
} from "./dtsReloadRunSession";

function candidate(overrides: Partial<DtsReloadCandidate> = {}): DtsReloadCandidate {
  return {
    bindingId: "binding-1",
    projectId: "project-1",
    propertyKey: "watchdog_time",
    displayName: "Watchdog",
    module: "charger",
    nodePath: "/amba/i2c@1/dev@6E",
    baselineValue: "<6000>",
    description: null,
    valueShapeKind: "cells",
    resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: { min: 0, max: 20000, cells: 1 },
    debuggable: true,
    ...overrides
  };
}

function criticalCandidate(overrides: Partial<DtsReloadCandidate> = {}): DtsReloadCandidate {
  return candidate({
    sensitiveMatch: {
      riskTier: "critical",
      requiredCapability: "parameter:edit-critical",
      ruleId: "rule-1",
      matchType: "path",
      pattern: "/amba/i2c@1/dev@6E",
      requiresElevatedCapability: true,
      requiresConfirmation: true
    },
    ...overrides
  });
}

function run(overrides: Partial<DtsReloadRun> = {}): DtsReloadRun {
  return {
    id: "run-1",
    projectId: "project-1",
    configRevisionId: null,
    status: "validated",
    purpose: "ordinary",
    restoresSourceRunId: null,
    failureCode: null,
    targets: [
      {
        bindingId: "binding-1",
        nodePath: "/amba/i2c@1/dev@6E",
        propertyKey: "watchdog_time",
        baselineValue: "<6000>",
        debugValue: "<7000>"
      }
    ],
    steps: [],
    diagnostics: [],
    toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
    overlaySource: null,
    overlaySourceSha256: null,
    artifact: { fileName: "debug-overlay-run-1.dtbo", sha256: "sha-art", sizeBytes: 32 },
    createdAt: "2026-08-10T00:00:00.000Z",
    completedAt: "2026-08-10T00:00:01.000Z",
    ...overrides
  };
}

function residueFixture(overrides: Partial<DtsReloadResidue> = {}): DtsReloadResidue {
  return {
    deviceId: "bridge:bridge-1",
    projectId: "project-1",
    sourceRunId: "run-residue",
    parameters: [
      {
        bindingId: "binding-1",
        propertyKey: "watchdog_time",
        nodePath: "/amba/i2c@1/dev@6E",
        baselineValue: "<6000>",
        debugValue: "<7000>"
      }
    ],
    recordedAt: "2026-08-10T00:00:00.000Z",
    ...overrides
  };
}

function createSession(options: DtsReloadRunSessionOptions = {}) {
  return createDtsReloadRunSession({
    initialProjectId: "project-1",
    writeRunId: () => undefined,
    readRunId: () => null,
    ...options
  });
}

/** Session with a loaded candidate list and a connected deploy target. */
async function createReadySession(
  items: DtsReloadCandidate[] = [candidate()],
  options: DtsReloadRunSessionOptions = {}
) {
  const session = createSession(options);
  const listCandidates = vi.fn(async () => ({ items }));
  const getRun = vi.fn(async (): Promise<DtsReloadRun> => run());
  await session.loadCandidates({ listCandidates, getRun });
  session.syncBridges(
    [{ id: "bridge-1", machineLabel: "Lab Mac", lastSeenAt: null }],
    { connected: true, bridgeId: "bridge-1" }
  );
  session.setTargetRef("device-serial-1");
  return session;
}

describe("dtsReloadRunSession", () => {
  describe("candidate loading and URL rehydration", () => {
    it("loads candidates and seeds the first debuggable candidate with its baseline", async () => {
      const session = createSession();
      const listCandidates = vi.fn(async () => ({
        items: [
          candidate({ bindingId: "binding-blocked", debuggable: false }),
          candidate({ bindingId: "binding-2", baselineValue: "<1>" })
        ]
      }));
      const getRun = vi.fn(async () => run());
      await session.loadCandidates({ listCandidates, getRun });

      const snapshot = session.getSnapshot();
      expect(listCandidates).toHaveBeenCalledWith("project-1");
      expect(snapshot.candidates).toHaveLength(2);
      expect(snapshot.selectedBindingIds).toEqual(["binding-2"]);
      expect(snapshot.debugValues).toEqual({ "binding-2": "<1>" });
      expect(snapshot.run).toBeNull();
      expect(getRun).not.toHaveBeenCalled();
    });

    it("rehydrates a same-project run id from the URL and adopts its deploy target", async () => {
      const session = createSession({
        readRunId: () => "run-1"
      });
      const existing = run({
        bridgeId: "bridge-9",
        targetRef: "AURORA-9",
        deviceId: "device-custom",
        protocol: "adb"
      });
      const getRun = vi.fn(async () => existing);
      await session.loadCandidates({
        listCandidates: async () => ({ items: [candidate()] }),
        getRun
      });

      const snapshot = session.getSnapshot();
      expect(getRun).toHaveBeenCalledWith("run-1");
      expect(snapshot.run).toEqual(existing);
      expect(snapshot.bridgeId).toBe("bridge-9");
      expect(snapshot.targetRef).toBe("AURORA-9");
      expect(snapshot.deviceId).toBe("device-custom");
      expect(snapshot.protocol).toBe("adb");
    });

    it("ignores a URL run from another project and clears the run", async () => {
      const session = createSession({ readRunId: () => "run-other" });
      await session.loadCandidates({
        listCandidates: async () => ({ items: [candidate()] }),
        getRun: async () => run({ projectId: "project-other" })
      });
      expect(session.getSnapshot().run).toBeNull();
    });

    it("clears the URL when the referenced run cannot be loaded", async () => {
      const writeRunId = vi.fn();
      const session = createSession({ readRunId: () => "run-gone", writeRunId });
      await session.loadCandidates({
        listCandidates: async () => ({ items: [candidate()] }),
        getRun: async () => {
          throw new Error("not found");
        }
      });
      expect(writeRunId).toHaveBeenCalledWith(null);
      expect(session.getSnapshot().run).toBeNull();
    });

    it("surfaces candidate load failures as the page error message", async () => {
      const session = createSession();
      await session.loadCandidates({
        listCandidates: async () => {
          throw new Error("boom");
        },
        getRun: async () => run()
      });
      expect(session.getSnapshot().errorMessage).toBe("boom");
      expect(session.getSnapshot().loading).toBe(false);
    });

    it("drops a stale in-flight load when the project changes mid-request", async () => {
      const session = createSession();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = session.loadCandidates({
        listCandidates: async () => {
          await gate;
          return { items: [candidate({ bindingId: "stale" })] };
        },
        getRun: async () => run()
      });
      session.selectProject("project-2");
      release!();
      await first;
      expect(session.getSnapshot().candidates).toEqual([]);
    });
  });

  describe("reload batch editing", () => {
    it("toggles, removes, resets, and clears batch entries", async () => {
      const second = candidate({ bindingId: "binding-2", baselineValue: "<1>", displayName: "Second" });
      const session = await createReadySession([candidate(), second]);

      session.toggleCandidate("binding-2");
      expect(session.getSnapshot().selectedBindingIds).toEqual(["binding-1", "binding-2"]);
      expect(session.getSnapshot().debugValues["binding-2"]).toBe("<1>");

      session.setDebugValue("binding-2", "<2>");
      expect(session.getSnapshot().selectedHasMeaningfulDebugChange).toBe(true);

      session.resetBatchToBaseline();
      expect(session.getSnapshot().debugValues["binding-2"]).toBe("<1>");
      expect(session.getSnapshot().selectedHasMeaningfulDebugChange).toBe(false);

      session.removeFromBatch("binding-2");
      expect(session.getSnapshot().selectedBindingIds).toEqual(["binding-1"]);

      session.clearBatch();
      expect(session.getSnapshot().selectedBindingIds).toEqual([]);
      expect(session.getSnapshot().selectedCandidates).toEqual([]);
    });

    it("does not toggle not-debuggable candidates", async () => {
      const blocked = candidate({ bindingId: "binding-blocked", debuggable: false });
      const session = await createReadySession([candidate(), blocked]);
      session.toggleCandidate("binding-blocked");
      expect(session.getSnapshot().selectedBindingIds).toEqual(["binding-1"]);
    });

    it("validates edit-sheet confirmations before adding to the batch", async () => {
      const session = await createReadySession();
      expect(session.confirmCandidateDebugValue("binding-1", "")).toBe("请输入调试值。");
      expect(session.confirmCandidateDebugValue("binding-1", "<6000>")).toBe(
        "调试值与库基线相同，无需加入本轮。"
      );
      expect(session.confirmCandidateDebugValue("binding-1", "<99999>")).toBe(
        "调试值超过声明的最大值 20000。"
      );
      expect(session.confirmCandidateDebugValue("binding-1", "<7000>")).toBeNull();
      expect(session.getSnapshot().debugValues["binding-1"]).toBe("<7000>");
    });
  });

  describe("start (sensitive-token gating)", () => {
    it("refuses to start without a meaningful debug change", async () => {
      const session = await createReadySession();
      const startRun = vi.fn();
      await session.start({ startRun });
      expect(startRun).not.toHaveBeenCalled();
      expect(session.getSnapshot().errorMessage).toBe(
        "本轮调试值均与库基线相同或为空，请先修改后再下发。"
      );
    });

    it("blocks start on a per-candidate constraint violation", async () => {
      const session = await createReadySession();
      session.setDebugValue("binding-1", "<99999>");
      const startRun = vi.fn();
      await session.start({ startRun });
      expect(startRun).not.toHaveBeenCalled();
      expect(session.getSnapshot().errorMessage).toBe("Watchdog：调试值超过声明的最大值 20000。");
    });

    it("never attaches the sensitive token without the explicit critical confirmation", async () => {
      const session = await createReadySession([criticalCandidate()]);
      session.setDebugValue("binding-1", "<7000>");
      const startRun = vi.fn(async () => run());

      await session.start({ startRun });
      expect(startRun).not.toHaveBeenCalled();
      expect(session.getSnapshot().errorMessage).toBe(
        "所选参数包含 critical 敏感节点，请先勾选明确确认后再启动。"
      );

      session.setCriticalConfirmed(true);
      await session.start({ startRun });
      expect(startRun).toHaveBeenCalledTimes(1);
      expect(startRun).toHaveBeenCalledWith({
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
        confirmationToken: "confirm-sensitive-reload"
      });
    });

    it("omits the confirmationToken key entirely for non-sensitive batches", async () => {
      const session = await createReadySession();
      session.setDebugValue("binding-1", "<7000>");
      const startRun = vi.fn(async () => run());
      await session.start({ startRun });
      expect(startRun).toHaveBeenCalledWith({
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
      });
      expect(startRun.mock.calls[0]![0]).not.toHaveProperty("confirmationToken");
    });

    it("resets the critical confirmation when critical candidates leave the selection", async () => {
      const session = await createReadySession([criticalCandidate()]);
      session.setCriticalConfirmed(true);
      expect(session.getSnapshot().criticalConfirmed).toBe(true);
      session.clearBatch();
      expect(session.getSnapshot().criticalConfirmed).toBe(false);
      session.toggleCandidate("binding-1");
      expect(session.getSnapshot().criticalConfirmed).toBe(false);
    });

    it("opens the deploy confirmation only when the target is ready", async () => {
      const notReady = createSession();
      await notReady.loadCandidates({
        listCandidates: async () => ({ items: [candidate()] }),
        getRun: async () => run()
      });
      notReady.setDebugValue("binding-1", "<7000>");
      await notReady.start({ startRun: async () => run() });
      expect(notReady.getSnapshot().deployConfirmOpen).toBe(false);
      expect(notReady.getSnapshot().errorMessage).toBe(
        "预检已通过。请先连接 Bridge 并检测设备目标后再确认部署。"
      );

      const ready = await createReadySession();
      ready.setDebugValue("binding-1", "<7000>");
      const writeRunId = vi.fn();
      await ready.start({ startRun: async () => run() });
      expect(ready.getSnapshot().deployConfirmOpen).toBe(true);
      expect(ready.getSnapshot().pendingDeployRun?.id).toBe("run-1");
      void writeRunId;
    });
  });

  describe("deploy confirmation (confirm-dts-reload gating)", () => {
    it("attaches confirm-dts-reload only through the explicit confirmDeploy command", async () => {
      const session = await createReadySession();
      session.setDebugValue("binding-1", "<7000>");
      const startRun = vi.fn(async () => run());
      const deployRun = vi.fn(async () => run({ status: "unverifiable", deviceId: "bridge:bridge-1" }));
      const getResidue = vi.fn(async () => null);

      await session.start({ startRun });
      // Start alone must never deploy, and no startRun payload may carry the deploy token.
      expect(deployRun).not.toHaveBeenCalled();
      for (const call of startRun.mock.calls) {
        expect(JSON.stringify(call[0])).not.toContain("confirm-dts-reload");
      }
      expect(session.getSnapshot().deployConfirmOpen).toBe(true);

      await session.confirmDeploy({ deployRun, getResidue });
      expect(deployRun).toHaveBeenCalledTimes(1);
      expect(deployRun).toHaveBeenCalledWith({
        runId: "run-1",
        deviceId: "bridge:bridge-1",
        bridgeId: "bridge-1",
        targetRef: "device-serial-1",
        protocol: "hdc",
        confirmationTokens: ["confirm-dts-reload"]
      });
      expect(session.getSnapshot().deployConfirmOpen).toBe(false);
      expect(session.getSnapshot().run?.status).toBe("unverifiable");
      expect(getResidue).toHaveBeenCalledWith("bridge:bridge-1");
    });

    it("cancelling the dialog deploys nothing", async () => {
      const session = await createReadySession();
      session.setDebugValue("binding-1", "<7000>");
      await session.start({ startRun: async () => run() });
      expect(session.getSnapshot().deployConfirmOpen).toBe(true);

      session.closeDeployConfirm();
      expect(session.getSnapshot().deployConfirmOpen).toBe(false);
      expect(session.getSnapshot().pendingDeployRun).toBeNull();
    });

    it("does not deploy when no pending run exists and the current run is not retryable", async () => {
      const session = await createReadySession();
      const deployRun = vi.fn();
      await session.confirmDeploy({ deployRun, getResidue: async () => null });
      expect(deployRun).not.toHaveBeenCalled();
    });

    it("does not deploy when the deploy target is incomplete", async () => {
      const session = createSession();
      await session.loadCandidates({
        listCandidates: async () => ({ items: [candidate()] }),
        getRun: async () => run()
      });
      session.openDeployConfirm(run());
      const deployRun = vi.fn();
      await session.confirmDeploy({ deployRun, getResidue: async () => null });
      expect(deployRun).not.toHaveBeenCalled();
    });

    it("optimistically clears residue after a restore-purpose deploy and survives a failed refresh", async () => {
      const session = await createReadySession();
      await session.loadResidue({ getResidue: async () => residueFixture() });
      expect(session.getSnapshot().residue).not.toBeNull();

      session.openDeployConfirm(run({ id: "run-restore", purpose: "restore-baseline" }));
      await session.confirmDeploy({
        deployRun: async () => run({ id: "run-restore", purpose: "restore-baseline", status: "verified" }),
        getResidue: async () => {
          throw new Error("refresh failed");
        }
      });
      expect(session.getSnapshot().residue).toBeNull();
      expect(session.getSnapshot().run?.status).toBe("verified");
    });

    it("keeps prior residue when an ordinary deploy's residue refresh fails", async () => {
      const session = await createReadySession();
      await session.loadResidue({ getResidue: async () => residueFixture() });
      session.openDeployConfirm(run());
      await session.confirmDeploy({
        deployRun: async () => run({ status: "unverifiable" }),
        getResidue: async () => {
          throw new Error("refresh failed");
        }
      });
      expect(session.getSnapshot().residue).not.toBeNull();
    });

    it("surfaces bridge-upgrade-required deploy failures with the releases path", async () => {
      const session = await createReadySession();
      session.openDeployConfirm(run());
      await session.confirmDeploy({
        deployRun: async () => {
          throw new WiseEffApiError(
            "VALIDATION_FAILED",
            "Device bridge is missing required RPC methods.",
            { code: "bridge-upgrade-required", releasesPath: "/api/v1/device-bridges/releases" },
            "req-upgrade"
          );
        },
        getResidue: async () => null
      });
      const snapshot = session.getSnapshot();
      expect(snapshot.deployError).toContain("missing required RPC methods");
      expect(snapshot.deployUpgradeReleasesPath).toBe("/api/v1/device-bridges/releases");
      expect(snapshot.deployConfirmOpen).toBe(true);
    });
  });

  describe("restore-baseline flow", () => {
    it("requires the explicit critical confirmation before attaching the sensitive token", async () => {
      const session = await createReadySession([criticalCandidate()]);
      await session.loadResidue({ getResidue: async () => residueFixture() });
      session.openRestoreConfirm();

      const restoreBaseline = vi.fn(async () =>
        run({ id: "run-restore", purpose: "restore-baseline" })
      );
      await session.confirmRestore({ restoreBaseline });
      expect(restoreBaseline).not.toHaveBeenCalled();
      expect(session.getSnapshot().restoreError).toBe("critical 敏感参数恢复基线前须明确确认。");

      session.setRestoreCriticalConfirmed(true);
      await session.confirmRestore({ restoreBaseline });
      expect(restoreBaseline).toHaveBeenCalledWith({
        projectId: "project-1",
        deviceId: "bridge:bridge-1",
        confirmationToken: "confirm-sensitive-reload"
      });
      // Validated restore chains into the deploy confirmation (which owns the deploy token).
      expect(session.getSnapshot().deployConfirmOpen).toBe(true);
      expect(session.getSnapshot().pendingDeployRun?.id).toBe("run-restore");
    });

    it("omits the token for non-critical residue and closes on failure message", async () => {
      const session = await createReadySession();
      await session.loadResidue({ getResidue: async () => residueFixture() });
      session.openRestoreConfirm();
      const restoreBaseline = vi.fn(async () =>
        run({ id: "run-restore", purpose: "restore-baseline" })
      );
      await session.confirmRestore({ restoreBaseline });
      expect(restoreBaseline).toHaveBeenCalledWith({
        projectId: "project-1",
        deviceId: "bridge:bridge-1"
      });
      expect(restoreBaseline.mock.calls[0]![0]).not.toHaveProperty("confirmationToken");
    });

    it("surfaces restore failures in the dialog", async () => {
      const session = await createReadySession();
      await session.loadResidue({ getResidue: async () => residueFixture() });
      session.openRestoreConfirm();
      await session.confirmRestore({
        restoreBaseline: async () => {
          throw new Error("restore blocked");
        }
      });
      expect(session.getSnapshot().restoreError).toBe("restore blocked");
      expect(session.getSnapshot().restoreConfirmOpen).toBe(true);
    });
  });

  describe("residue loading", () => {
    it("clears residue when no device id is set", async () => {
      const session = createSession();
      const getResidue = vi.fn(async () => residueFixture());
      await session.loadResidue({ getResidue });
      expect(getResidue).not.toHaveBeenCalled();
      expect(session.getSnapshot().residue).toBeNull();
    });

    it("keeps previously shown residue when a refresh fails transiently", async () => {
      const session = await createReadySession();
      await session.loadResidue({ getResidue: async () => residueFixture() });
      await session.loadResidue({
        getResidue: async () => {
          throw new Error("transient");
        }
      });
      expect(session.getSnapshot().residue).not.toBeNull();
      expect(session.getSnapshot().residueLoading).toBe(false);
    });
  });

  describe("history loading and pagination", () => {
    const historyItem = (id: string) => ({
      id,
      projectId: "project-1",
      deviceId: "bridge:bridge-1",
      status: "verified" as const,
      purpose: "ordinary" as const,
      failureCode: null,
      targetCount: 1,
      propertyKeys: ["watchdog_time"],
      artifact: null,
      integrityCheck: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      completedAt: null
    });

    it("loads the first page and appends more via the cursor", async () => {
      const session = await createReadySession();
      const listRuns = vi.fn(async (input: { cursor?: string | null }) =>
        input.cursor
          ? { items: [historyItem("run-11")], nextCursor: null }
          : { items: [historyItem("run-1")], nextCursor: "cursor-1" }
      );

      await session.refreshHistory({ listRuns });
      expect(listRuns).toHaveBeenCalledWith({ projectId: "project-1", limit: 10 });
      expect(session.getSnapshot().historyItems).toHaveLength(1);
      expect(session.getSnapshot().historyNextCursor).toBe("cursor-1");

      await session.loadMoreHistory({ listRuns });
      expect(listRuns).toHaveBeenLastCalledWith({
        projectId: "project-1",
        cursor: "cursor-1",
        limit: 10
      });
      expect(session.getSnapshot().historyItems.map((item) => item.id)).toEqual([
        "run-1",
        "run-11"
      ]);
      expect(session.getSnapshot().historyNextCursor).toBeNull();
    });

    it("passes the device filter and refuses to enable it without a device id", async () => {
      const session = await createReadySession();
      session.setHistoryFilterDevice(true);
      const listRuns = vi.fn(async () => ({ items: [historyItem("run-1")], nextCursor: null }));
      await session.refreshHistory({ listRuns });
      expect(listRuns).toHaveBeenCalledWith({
        projectId: "project-1",
        deviceId: "bridge:bridge-1",
        limit: 10
      });

      const bare = createSession();
      bare.setHistoryFilterDevice(true);
      expect(bare.getSnapshot().historyFilterDevice).toBe(false);
    });

    it("records history errors without leaving stale items", async () => {
      const session = await createReadySession();
      await session.refreshHistory({
        listRuns: async () => {
          throw new Error("history down");
        }
      });
      expect(session.getSnapshot().historyError).toBe("history down");
      expect(session.getSnapshot().historyItems).toEqual([]);
      expect(session.getSnapshot().historyLoading).toBe(false);
    });
  });

  describe("history run detail and artifact download", () => {
    it("opens a history run and adopts its deploy target", async () => {
      const session = await createReadySession();
      const writeRunId = vi.fn();
      void writeRunId;
      const detail = run({
        id: "run-history",
        status: "failed",
        bridgeId: "bridge-h",
        targetRef: "TARGET-H",
        deviceId: "device-h",
        protocol: "adb"
      });
      const getRun = vi.fn(async () => detail);
      await session.openHistoryRun({ getRun }, "run-history");
      const snapshot = session.getSnapshot();
      expect(getRun).toHaveBeenCalledWith("run-history");
      expect(snapshot.run?.id).toBe("run-history");
      expect(snapshot.bridgeId).toBe("bridge-h");
      expect(snapshot.targetRef).toBe("TARGET-H");
      expect(snapshot.deviceId).toBe("device-h");
      expect(snapshot.protocol).toBe("adb");
      expect(snapshot.canRetryDeploy).toBe(true);
    });

    it("blocks downloads for retention-expired artifacts without calling the repository", async () => {
      const session = await createReadySession();
      await session.openHistoryRun(
        { getRun: async () => run({ artifactRetentionExpired: true }) },
        "run-1"
      );
      const downloadArtifact = vi.fn();
      const result = await session.downloadArtifact({ downloadArtifact });
      expect(result).toBeNull();
      expect(downloadArtifact).not.toHaveBeenCalled();
      expect(session.getSnapshot().errorMessage).toContain("已超过保留期");
    });

    it("returns the artifact blob and file name for downloadable runs", async () => {
      const session = await createReadySession();
      await session.openHistoryRun({ getRun: async () => run() }, "run-1");
      const blob = new Blob([Uint8Array.from([1, 2, 3])]);
      const downloadArtifact = vi.fn(async () => blob);
      const result = await session.downloadArtifact({ downloadArtifact });
      expect(downloadArtifact).toHaveBeenCalledWith("run-1");
      expect(result).toEqual({ blob, fileName: "debug-overlay-run-1.dtbo" });
    });
  });

  describe("bridge and deploy-target state", () => {
    it("prefers the connected bridge, keeps a still-listed selection, and derives the device id", () => {
      const session = createSession();
      session.syncBridges(
        [
          { id: "bridge-a", machineLabel: "A", lastSeenAt: null },
          { id: "bridge-b", machineLabel: "B", lastSeenAt: null }
        ],
        { connected: true, bridgeId: "bridge-b" }
      );
      expect(session.getSnapshot().bridgeId).toBe("bridge-b");
      expect(session.getSnapshot().deviceId).toBe("bridge:bridge-b");

      // The selection survives while the bridge stays registered.
      session.syncBridges(
        [
          { id: "bridge-a", machineLabel: "A", lastSeenAt: null },
          { id: "bridge-b", machineLabel: "B", lastSeenAt: null }
        ],
        null
      );
      expect(session.getSnapshot().bridgeId).toBe("bridge-b");

      // A user-touched device id stops following the bridge default.
      session.setDeviceId("custom-device");
      session.syncBridges([{ id: "bridge-a", machineLabel: "A", lastSeenAt: null }], null);
      expect(session.getSnapshot().bridgeId).toBe("bridge-a");
      expect(session.getSnapshot().deviceId).toBe("custom-device");
    });

    it("computes deployDeviceId from the selected bridge even when a run pinned another id", () => {
      const session = createSession();
      session.syncBridges([{ id: "bridge-a", machineLabel: "A", lastSeenAt: null }], null);
      session.setDeviceId("device-pinned");
      const snapshot = session.getSnapshot();
      expect(snapshot.deviceId).toBe("device-pinned");
      expect(snapshot.deployDeviceId).toBe("bridge:bridge-a");
    });
  });
});
