import { describe, expect, it } from "vitest";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import { validateDebugValue } from "@/domain/dtsReload/debugValue";
import {
  createMockDtsReloadBridgeSeams,
  createMockDtsReloadRepository,
  MOCK_DTS_RELOAD_BRIDGE_ID,
  MOCK_DTS_RELOAD_DEVICE_ID,
  MOCK_DTS_RELOAD_TARGET_REF
} from "./mockDtsReloadRepository";

const PROJECT_ID = "project-teaching";

function createRepo(): DtsReloadRepository {
  return createMockDtsReloadRepository();
}

async function firstDebuggableBindingId(repo: DtsReloadRepository): Promise<string> {
  const { items } = await repo.listCandidates(PROJECT_ID);
  return items.find((item) => item.debuggable && !item.sensitiveMatch)!.bindingId;
}

describe("createMockDtsReloadRepository (DtsReloadRepository contract)", () => {
  it("serves candidates across every supported reload value shape with self-consistent baselines", async () => {
    const repo = createRepo();
    const { items } = await repo.listCandidates(PROJECT_ID);

    const kinds = items
      .filter((item) => item.debuggable)
      .map((item) => {
        const shape = item.resolvedValueShape;
        if (!shape?.kind) return "unknown";
        if (shape.kind === "cells") return `cells-${shape.bits ?? 32}`;
        return shape.kind;
      });
    expect(kinds).toEqual(
      expect.arrayContaining([
        "cells-32",
        "cells-8",
        "cells-16",
        "string",
        "string-list",
        "phandle-cells",
        "boolean",
        "empty",
        "phandle-list",
        "mixed"
      ])
    );

    // Every debuggable baseline must pass the shared authoring pre-check for its own shape —
    // otherwise the seeded data would teach users invalid authorings.
    for (const item of items) {
      if (!item.debuggable || item.baselineValue === null) continue;
      expect({ key: item.propertyKey, error: validateDebugValue(item.baselineValue, item) }).toEqual({
        key: item.propertyKey,
        error: null
      });
    }

    // Honest blocked rows and both sensitive tiers are represented.
    expect(items.some((item) => item.blockReason === "unsupported-value-shape")).toBe(true);
    expect(items.some((item) => item.blockReason === "no-baseline-value")).toBe(true);
    expect(items.some((item) => item.sensitiveMatch?.riskTier === "critical")).toBe(true);
    expect(items.some((item) => item.sensitiveMatch?.riskTier === "high")).toBe(true);

    // Single fixture dataset for any project id (same principle as the structured DTS mock).
    const other = await repo.listCandidates("project-other");
    expect(other.items.map((item) => item.bindingId)).toEqual(items.map((item) => item.bindingId));
  });

  it("runs the full lifecycle: start -> validated, deploy with confirm-dts-reload -> verified with evidence", async () => {
    const repo = createRepo();
    const bindingId = await firstDebuggableBindingId(repo);

    const started = await repo.startRun({
      projectId: PROJECT_ID,
      targets: [{ bindingId, debugValue: "<7000>" }]
    });
    expect(started.status).toBe("validated");
    expect(started.purpose).toBe("ordinary");
    expect(started.steps.map((step) => step.step)).toEqual([
      "compile-base",
      "compile-overlay",
      "dry-run-merge",
      "assert-effect"
    ]);
    expect(started.overlaySource).toContain("target-path");
    expect(started.overlaySource).toContain("<7000>");
    expect(started.artifact?.fileName).toContain(started.id);

    await expect(
      repo.deployRun({
        runId: started.id,
        deviceId: MOCK_DTS_RELOAD_DEVICE_ID,
        bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID,
        targetRef: MOCK_DTS_RELOAD_TARGET_REF,
        protocol: "hdc",
        confirmationTokens: []
      })
    ).rejects.toThrow(/confirm-dts-reload/);

    const deployed = await repo.deployRun({
      runId: started.id,
      deviceId: MOCK_DTS_RELOAD_DEVICE_ID,
      bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID,
      targetRef: MOCK_DTS_RELOAD_TARGET_REF,
      protocol: "hdc",
      confirmationTokens: ["confirm-dts-reload"]
    });
    expect(deployed.status).toBe("verified");
    expect(deployed.deviceId).toBe(MOCK_DTS_RELOAD_DEVICE_ID);
    expect(deployed.steps.map((step) => step.step)).toContain("trigger-reload");
    expect(deployed.reloadSnapshot?.artifactDigest?.integrityCheck).toBe("sha256");
    expect(deployed.reloadSnapshot?.kernelSignal?.captureStatus).toBe("obtained");
    expect(deployed.reloadSnapshot?.behaviouralVerification?.outcomes[0]).toMatchObject({
      outcome: "verified",
      readValue: "7000"
    });

    const reloaded = await repo.getRun(started.id);
    expect(reloaded.status).toBe("verified");

    const blob = await repo.downloadArtifact(started.id);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("refuses critical-sensitive starts without confirm-sensitive-reload and accepts them with it", async () => {
    const repo = createRepo();
    const { items } = await repo.listCandidates(PROJECT_ID);
    const critical = items.find((item) => item.sensitiveMatch?.riskTier === "critical")!;

    await expect(
      repo.startRun({
        projectId: PROJECT_ID,
        targets: [{ bindingId: critical.bindingId, debugValue: "<3500>" }]
      })
    ).rejects.toThrow(/confirm-sensitive-reload/);

    const started = await repo.startRun({
      projectId: PROJECT_ID,
      targets: [{ bindingId: critical.bindingId, debugValue: "<3500>" }],
      confirmationToken: "confirm-sensitive-reload"
    });
    expect(started.status).toBe("validated");
  });

  it("records residue on ordinary deploys and clears it through the restore-baseline lifecycle", async () => {
    const repo = createRepo();

    // Seeded device story: the mock device starts with residue from the seeded run.
    const seeded = await repo.getResidue(MOCK_DTS_RELOAD_DEVICE_ID);
    expect(seeded?.parameters[0]).toMatchObject({ propertyKey: "watchdog_time", debugValue: "<7000>" });

    const restore = await repo.restoreBaseline({
      projectId: PROJECT_ID,
      deviceId: MOCK_DTS_RELOAD_DEVICE_ID
    });
    expect(restore.purpose).toBe("restore-baseline");
    expect(restore.status).toBe("validated");
    expect(restore.restoresSourceRunId).toBe(seeded!.sourceRunId);
    expect(restore.targets[0]).toMatchObject({ debugValue: "<6000>", baselineValue: "<6000>" });

    await repo.deployRun({
      runId: restore.id,
      deviceId: MOCK_DTS_RELOAD_DEVICE_ID,
      bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID,
      targetRef: MOCK_DTS_RELOAD_TARGET_REF,
      protocol: "hdc",
      confirmationTokens: ["confirm-dts-reload"]
    });
    expect(await repo.getResidue(MOCK_DTS_RELOAD_DEVICE_ID)).toBeNull();
    await expect(
      repo.restoreBaseline({ projectId: PROJECT_ID, deviceId: MOCK_DTS_RELOAD_DEVICE_ID })
    ).rejects.toThrow(/残留/);

    // A fresh ordinary deploy records residue bookkeeping again.
    const bindingId = await firstDebuggableBindingId(repo);
    const started = await repo.startRun({
      projectId: PROJECT_ID,
      targets: [{ bindingId, debugValue: "<7100>" }]
    });
    await repo.deployRun({
      runId: started.id,
      deviceId: MOCK_DTS_RELOAD_DEVICE_ID,
      bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID,
      targetRef: MOCK_DTS_RELOAD_TARGET_REF,
      protocol: "hdc",
      confirmationTokens: ["confirm-dts-reload"]
    });
    const recorded = await repo.getResidue(MOCK_DTS_RELOAD_DEVICE_ID);
    expect(recorded?.sourceRunId).toBe(started.id);
    expect(recorded?.parameters[0]?.debugValue).toBe("<7100>");
  });

  it("paginates seeded history with a cursor and filters by device id", async () => {
    const repo = createRepo();

    const firstPage = await repo.listRuns({ projectId: PROJECT_ID, limit: 10 });
    expect(firstPage.items).toHaveLength(10);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await repo.listRuns({
      projectId: PROJECT_ID,
      cursor: firstPage.nextCursor,
      limit: 10
    });
    expect(secondPage.items.length).toBeGreaterThan(0);
    expect(secondPage.nextCursor).toBeNull();
    const allIds = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    // Newest first, and the seeded statuses include failure/blocked/restore shapes.
    const createdAts = firstPage.items.map((item) => item.createdAt);
    expect([...createdAts].sort().reverse()).toEqual(createdAts);
    const statuses = new Set([...firstPage.items, ...secondPage.items].map((item) => item.status));
    expect(statuses).toEqual(
      expect.any(Set)
    );
    expect(statuses.has("failed")).toBe(true);
    expect(statuses.has("blocked")).toBe(true);
    expect(
      [...firstPage.items, ...secondPage.items].some((item) => item.purpose === "restore-baseline")
    ).toBe(true);

    const deviceScoped = await repo.listRuns({ deviceId: MOCK_DTS_RELOAD_DEVICE_ID, limit: 20 });
    expect(deviceScoped.items.every((item) => item.deviceId === MOCK_DTS_RELOAD_DEVICE_ID)).toBe(true);
    const unbound = await repo.listRuns({ deviceId: "bridge:elsewhere", limit: 20 });
    expect(unbound.items).toHaveLength(0);
  });

  it("keeps cursor pages stable when a run is created between pages (no duplicate rows)", async () => {
    const repo = createRepo();
    const firstPage = await repo.listRuns({ projectId: PROJECT_ID, limit: 10 });
    const bindingId = await firstDebuggableBindingId(repo);
    const started = await repo.startRun({
      projectId: PROJECT_ID,
      targets: [{ bindingId, debugValue: "<7000>" }]
    });

    const secondPage = await repo.listRuns({
      projectId: PROJECT_ID,
      cursor: firstPage.nextCursor,
      limit: 10
    });
    const ids = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The new run belongs to a refreshed first page, not to the continuation page.
    expect(ids).not.toContain(started.id);
    const refreshed = await repo.listRuns({ projectId: PROJECT_ID, limit: 10 });
    expect(refreshed.items[0]?.id).toBe(started.id);
  });

  it("exposes seeded run detail for history rows and rejects unknown run ids", async () => {
    const repo = createRepo();
    const { items } = await repo.listRuns({ projectId: PROJECT_ID, limit: 10 });
    const detail = await repo.getRun(items[0]!.id);
    expect(detail.targets.length).toBeGreaterThan(0);
    expect(detail.overlaySource).toContain("target-path");
    await expect(repo.getRun("missing-run")).rejects.toThrow(/missing-run/);
  });

  it("serves and updates the organisation reload configuration", async () => {
    const repo = createRepo();
    const view = await repo.getReloadConfiguration();
    expect(view.organisation.source).toBe("seeded-default");
    expect(view.organisation.kernelLogCommand).toBe("dmesg");

    const updated = await repo.updateOrganisationReloadConfiguration({
      destinationDirectory: "/data/local/tmp/custom",
      destinationFilename: "custom.dtbo",
      triggerNodePath: "/sys/kernel/custom/reload",
      triggerPayload: "1",
      kernelLogCommand: "dmesg"
    });
    expect(updated.source).toBe("organisation");
    expect(updated.destinationFilename).toBe("custom.dtbo");
    const reread = await repo.getReloadConfiguration();
    expect(reread.organisation.destinationFilename).toBe("custom.dtbo");
  });

  it("provides stable bridge seams matching the seeded device identifiers", async () => {
    const seams = createMockDtsReloadBridgeSeams();
    expect(seams.bridges[0]).toMatchObject({ id: MOCK_DTS_RELOAD_BRIDGE_ID });
    await expect(seams.probeBridgeHealth()).resolves.toEqual({
      connected: true,
      bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID
    });
    const targets = await seams.detectTargets();
    expect(targets[0]).toMatchObject({
      targetRef: MOCK_DTS_RELOAD_TARGET_REF,
      bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID
    });
    expect(`bridge:${MOCK_DTS_RELOAD_BRIDGE_ID}`).toBe(MOCK_DTS_RELOAD_DEVICE_ID);
  });
});
