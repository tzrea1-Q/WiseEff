import { describe, expect, it, vi } from "vitest";
import { createPairingService } from "./pairingService";

describe("pairingService", () => {
  it("issues a 6-digit code and rejects reuse", async () => {
    const repo = {
      createPairingCode: vi.fn().mockResolvedValue(undefined),
      consumePairingCode: vi.fn()
        .mockResolvedValueOnce({ userId: "u-1", organizationId: "org-1" })
        .mockResolvedValueOnce(null),
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
});
