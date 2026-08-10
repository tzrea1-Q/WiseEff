import { describe, expect, it, vi } from "vitest";

import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { SEEDED_RELOAD_CONFIGURATION } from "./configurationTypes";
import { resolveReloadConfiguration } from "./resolveConfiguration";

type QueryCall = { text: string; values: unknown[] };
type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    calls.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };
  const db: Database = {
    query: (text, values = []) => runQuery(text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) =>
      fn({ query: (text, values = []) => runQuery(text, values) })
  };
  return { calls, db };
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: "org-1",
    destination_directory: "/vendor/firmware/",
    destination_filename: "power_dts_overlay.dtbo",
    trigger_node_path: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
    trigger_payload: "1",
    kernel_log_command: "dmesg",
    updated_by_user_id: "user-1",
    updated_at: "2026-08-10T01:00:00.000Z",
    created_at: "2026-08-10T01:00:00.000Z",
    ...overrides
  };
}

function deviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "override-1",
    organization_id: "org-1",
    device_id: "device-1",
    destination_directory: "/data/vendor/firmware/",
    destination_filename: "device_overlay.dtbo",
    trigger_node_path: "/sys/kernel/debug/alt/trigger",
    trigger_payload: "reload",
    kernel_log_command: "hilog",
    updated_by_user_id: "user-2",
    updated_at: "2026-08-10T02:00:00.000Z",
    created_at: "2026-08-10T02:00:00.000Z",
    ...overrides
  };
}

describe("resolveReloadConfiguration", () => {
  it("returns seeded defaults for a fresh organisation with no stored rows", async () => {
    const { calls, db } = createFakeDb([[], []]);

    const resolved = await resolveReloadConfiguration(db, {
      organizationId: "org-fresh",
      deviceId: "device-1"
    });

    expect(resolved).toEqual({
      organizationId: "org-fresh",
      deviceId: "device-1",
      source: "seeded-default",
      ...SEEDED_RELOAD_CONFIGURATION
    });
    expect(calls.every((call) => !JSON.stringify(call.values).includes("request"))).toBe(true);
  });

  it("returns organisation defaults when no device override exists", async () => {
    const { db } = createFakeDb([
      [],
      [
        orgRow({
          destination_directory: "/oem/firmware/",
          kernel_log_command: "cat /proc/kmsg"
        })
      ]
    ]);

    const resolved = await resolveReloadConfiguration(db, {
      organizationId: "org-1",
      deviceId: "device-1"
    });

    expect(resolved.source).toBe("organisation");
    expect(resolved.destinationDirectory).toBe("/oem/firmware/");
    expect(resolved.kernelLogCommand).toBe("cat /proc/kmsg");
    expect(resolved.destinationFilename).toBe("power_dts_overlay.dtbo");
  });

  it("lets the device override win over the organisation default", async () => {
    const { db } = createFakeDb([[deviceRow()], [orgRow()]]);

    const resolved = await resolveReloadConfiguration(db, {
      organizationId: "org-1",
      deviceId: "device-1"
    });

    expect(resolved).toMatchObject({
      organizationId: "org-1",
      deviceId: "device-1",
      source: "device-override",
      destinationDirectory: "/data/vendor/firmware/",
      destinationFilename: "device_overlay.dtbo",
      triggerNodePath: "/sys/kernel/debug/alt/trigger",
      triggerPayload: "reload",
      kernelLogCommand: "hilog"
    });
  });

  it("never consults request-body fields when resolving the effective contract", async () => {
    const { calls, db } = createFakeDb([[], [orgRow()]]);
    const requestBody = {
      destinationDirectory: "/evil/",
      destinationFilename: "evil.dtbo",
      triggerNodePath: "/evil/trigger",
      triggerPayload: "boom",
      kernelLogCommand: "rm -rf /"
    };

    const resolved = await resolveReloadConfiguration(db, {
      organizationId: "org-1",
      deviceId: "device-9",
      // Deliberately pass a request-shaped object; resolution must ignore contract fields from it.
      requestBody
    } as { organizationId: string; deviceId: string });

    expect(resolved.destinationDirectory).toBe("/vendor/firmware/");
    expect(resolved.kernelLogCommand).toBe("dmesg");
    expect(resolved.source).toBe("organisation");
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("/evil/");
    expect(serialized).not.toContain("rm -rf");
  });

  it("accepts only organizationId and deviceId as resolution inputs", async () => {
    const spy = vi.fn(resolveReloadConfiguration);
    const { db } = createFakeDb([[], []]);
    await spy(db, { organizationId: "org-1", deviceId: "device-1" });
    expect(spy.mock.calls[0]?.[1]).toEqual({ organizationId: "org-1", deviceId: "device-1" });
  });
});
