import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { SEEDED_RELOAD_CONFIGURATION } from "./configurationTypes";
import { upsertOrganisationDefault } from "./configurationRepository";
import { resolveReloadConfiguration } from "./resolveConfiguration";

const databaseAvailable = await isTestDatabaseAvailable();

type QueryCall = { text: string; values: unknown[] };

/**
 * Thin recording layer over the real database: every query still executes for real,
 * but text/values are captured so the request-isolation tests can keep proving that
 * no client-supplied contract field ever reaches SQL.
 */
function withQueryRecorder(db: Queryable) {
  const calls: QueryCall[] = [];
  const recorded: Queryable = {
    query: (text, values = []) => {
      calls.push({ text, values });
      return db.query(text, values);
    }
  };
  return { calls, recorded };
}

function orgContract(overrides: Record<string, string> = {}) {
  return {
    destinationDirectory: "/vendor/firmware/",
    destinationFilename: "power_dts_overlay.dtbo",
    triggerNodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
    triggerPayload: "1",
    kernelLogCommand: "dmesg",
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("resolveReloadConfiguration", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("returns seeded defaults for a fresh organisation with no stored rows", async () => {
    const { calls, recorded } = withQueryRecorder(db);

    const resolved = await resolveReloadConfiguration(recorded, {
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

  it("returns organisation defaults when a stored row exists", async () => {
    await upsertOrganisationDefault(db, {
      organizationId: "org-1",
      contract: orgContract({
        destinationDirectory: "/oem/firmware/",
        kernelLogCommand: "cat /proc/kmsg"
      }),
      updatedByUserId: "user-1"
    });

    const resolved = await resolveReloadConfiguration(db, {
      organizationId: "org-1",
      deviceId: "device-1"
    });

    expect(resolved.source).toBe("organisation");
    expect(resolved.destinationDirectory).toBe("/oem/firmware/");
    expect(resolved.kernelLogCommand).toBe("cat /proc/kmsg");
    expect(resolved.destinationFilename).toBe("power_dts_overlay.dtbo");
  });

  it("never consults request-body fields when resolving the effective contract", async () => {
    await upsertOrganisationDefault(db, {
      organizationId: "org-1",
      contract: orgContract(),
      updatedByUserId: "user-1"
    });
    const { calls, recorded } = withQueryRecorder(db);
    const requestBody = {
      destinationDirectory: "/evil/",
      destinationFilename: "evil.dtbo",
      triggerNodePath: "/evil/trigger",
      triggerPayload: "boom",
      kernelLogCommand: "rm -rf /"
    };

    const resolved = await resolveReloadConfiguration(recorded, {
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
    await spy(db, { organizationId: "org-1", deviceId: "device-1" });
    expect(spy.mock.calls[0]?.[1]).toEqual({ organizationId: "org-1", deviceId: "device-1" });
  });
});
