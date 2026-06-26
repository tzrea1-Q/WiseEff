import { describe, expect, it } from "vitest";

import { pickBridgeToReuse } from "./machineIdentity";
import type { DeviceBridgeRecord } from "./types";

function bridge(partial: Partial<DeviceBridgeRecord> & Pick<DeviceBridgeRecord, "id">): DeviceBridgeRecord {
  return {
    organizationId: "org-1",
    userId: "u-1",
    machineLabel: "WIN-PC",
    platform: "windows",
    arch: "amd64",
    clientVersion: null,
    capabilities: {},
    createdAt: "2026-06-23T00:00:00.000Z",
    lastSeenAt: null,
    revokedAt: null,
    ...partial
  };
}

describe("pickBridgeToReuse", () => {
  it("prefers the most recently seen bridge", () => {
    const selected = pickBridgeToReuse([
      bridge({ id: "br-old", lastSeenAt: "2026-06-20T00:00:00.000Z" }),
      bridge({ id: "br-new", lastSeenAt: "2026-06-25T00:00:00.000Z" })
    ]);

    expect(selected.id).toBe("br-new");
  });

  it("falls back to the newest created bridge when last seen is empty", () => {
    const selected = pickBridgeToReuse([
      bridge({ id: "br-old", createdAt: "2026-06-20T00:00:00.000Z" }),
      bridge({ id: "br-new", createdAt: "2026-06-25T00:00:00.000Z" })
    ]);

    expect(selected.id).toBe("br-new");
  });
});
