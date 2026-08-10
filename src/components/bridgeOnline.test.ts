import { describe, expect, it } from "vitest";

import { BRIDGE_ONLINE_WINDOW_MS, inferBridgeOnline } from "./bridgeOnline";

const now = 1_700_000_000_000;
const recent = new Date(now - 30_000).toISOString();
const stale = new Date(now - BRIDGE_ONLINE_WINDOW_MS - 1).toISOString();

describe("inferBridgeOnline", () => {
  it("uses lastSeen when health is unavailable", () => {
    expect(inferBridgeOnline({ id: "b1", lastSeenAt: recent }, null, { now })).toBe(true);
    expect(inferBridgeOnline({ id: "b1", lastSeenAt: stale }, null, { now })).toBe(false);
  });

  it("trusts health exclusively for the matched bridgeId", () => {
    expect(
      inferBridgeOnline({ id: "b1", lastSeenAt: recent }, { connected: true, bridgeId: "b1" }, { now })
    ).toBe(true);
    expect(
      inferBridgeOnline({ id: "b1", lastSeenAt: recent }, { connected: false, bridgeId: "b1" }, { now })
    ).toBe(false);
  });

  it("does not use lastSeen when local health reports nothing connected", () => {
    expect(
      inferBridgeOnline(
        { id: "b1", lastSeenAt: recent },
        { connected: false, bridgeId: undefined },
        { now }
      )
    ).toBe(false);
  });

  it("falls back to lastSeen for other registered bridges when local health is attached elsewhere", () => {
    expect(
      inferBridgeOnline(
        { id: "b1", lastSeenAt: recent },
        { connected: true, bridgeId: "b-other" },
        { now }
      )
    ).toBe(true);
    expect(
      inferBridgeOnline(
        { id: "b1", lastSeenAt: stale },
        { connected: true, bridgeId: "b-other" },
        { now }
      )
    ).toBe(false);
  });

  it("with healthExclusive, never uses lastSeen when any health result exists", () => {
    expect(
      inferBridgeOnline(
        { id: "b1", lastSeenAt: recent },
        { connected: true, bridgeId: "b-other" },
        { healthExclusive: true, now }
      )
    ).toBe(false);
    expect(
      inferBridgeOnline(
        { id: "b1", lastSeenAt: recent },
        { connected: false, bridgeId: undefined },
        { healthExclusive: true, now }
      )
    ).toBe(false);
    expect(
      inferBridgeOnline(
        { id: "b1", lastSeenAt: recent },
        { connected: true, bridgeId: "b1" },
        { healthExclusive: true, now }
      )
    ).toBe(true);
  });
});
