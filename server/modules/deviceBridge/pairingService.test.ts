import { describe, expect, it, vi } from "vitest";

import { createPairingService } from "./pairingService";

describe("pairingService", () => {
  it("issues a 6-digit code and rejects reuse", async () => {
    const repo = {
      createPairingCode: vi.fn().mockResolvedValue(undefined),
      consumePairingCode: vi.fn()
        .mockResolvedValueOnce({ userId: "u-1", organizationId: "org-1" })
        .mockResolvedValueOnce(null),
      listActiveBridgesForMachine: vi.fn().mockResolvedValue([]),
      createBridge: vi.fn().mockResolvedValue({
        id: "br-1",
        organizationId: "org-1",
        userId: "u-1",
        machineLabel: "WIN-PC",
        platform: "windows",
        arch: "amd64",
        clientVersion: null,
        capabilities: {},
        createdAt: "2026-06-23T00:00:00.000Z",
        lastSeenAt: null,
        revokedAt: null
      }),
      createBridgeToken: vi.fn().mockResolvedValue({ id: "tok-1" })
    };
    const service = createPairingService({ repo: repo as never, now: () => new Date("2026-06-23T00:00:00Z") });
    const issued = await service.issuePairingCode({ userId: "u-1", organizationId: "org-1" });
    expect(issued.code).toMatch(/^\d{6}$/);
    const paired = await service.pairWithCode({ code: issued.code, machineLabel: "WIN-PC", platform: "windows", arch: "amd64" });
    expect(paired.bridgeToken).toMatch(/^wb_/);
    await expect(service.pairWithCode({ code: issued.code, machineLabel: "WIN-PC", platform: "windows", arch: "amd64" })).rejects.toThrow(/consumed/i);
  });

  it("reuses the active bridge for the same machine and revokes duplicates", async () => {
    const repo = {
      createPairingCode: vi.fn().mockResolvedValue(undefined),
      consumePairingCode: vi.fn().mockResolvedValue({ userId: "u-1", organizationId: "org-1" }),
      listActiveBridgesForMachine: vi.fn().mockResolvedValue([
        {
          id: "br-stale",
          organizationId: "org-1",
          userId: "u-1",
          machineLabel: "Tzrea1deMacBook-Air.local",
          platform: "darwin",
          arch: "arm64",
          clientVersion: "0.1.0",
          capabilities: {},
          createdAt: "2026-06-20T00:00:00.000Z",
          lastSeenAt: null,
          revokedAt: null
        },
        {
          id: "br-active",
          organizationId: "org-1",
          userId: "u-1",
          machineLabel: "Tzrea1deMacBook-Air.local",
          platform: "darwin",
          arch: "arm64",
          clientVersion: "0.1.0",
          capabilities: {},
          createdAt: "2026-06-22T00:00:00.000Z",
          lastSeenAt: "2026-06-25T10:21:02.000Z",
          revokedAt: null
        }
      ]),
      revokeBridge: vi.fn().mockResolvedValue(null),
      revokeBridgeTokensForBridge: vi.fn().mockResolvedValue(undefined),
      updateBridgeClientVersion: vi.fn().mockResolvedValue(undefined),
      createBridgeToken: vi.fn().mockResolvedValue({ id: "tok-2" }),
      createBridge: vi.fn()
    };
    const service = createPairingService({ repo: repo as never, now: () => new Date("2026-06-25T10:30:00Z") });
    const issued = await service.issuePairingCode({ userId: "u-1", organizationId: "org-1" });
    const paired = await service.pairWithCode({
      code: issued.code,
      machineLabel: "Tzrea1deMacBook-Air.local",
      platform: "darwin",
      arch: "arm64",
      clientVersion: "0.1.0"
    });

    expect(paired.bridgeId).toBe("br-active");
    expect(repo.createBridge).not.toHaveBeenCalled();
    expect(repo.revokeBridge).toHaveBeenCalledWith({
      bridgeId: "br-stale",
      userId: "u-1",
      organizationId: "org-1",
      revokedAt: new Date("2026-06-25T10:30:00Z")
    });
    expect(repo.revokeBridgeTokensForBridge).toHaveBeenCalledWith({
      bridgeId: "br-active",
      revokedAt: new Date("2026-06-25T10:30:00Z")
    });
    expect(repo.createBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        bridgeId: "br-active"
      })
    );
  });
});
