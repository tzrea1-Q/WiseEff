import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { SEEDED_RELOAD_CONFIGURATION } from "./configurationTypes";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

import { createAuditEvent } from "../audit/repository";
import {
  getReloadConfigurationAdminView,
  removeDeviceReloadConfiguration,
  updateOrganisationReloadConfiguration,
  upsertDeviceReloadConfiguration
} from "./configurationService";

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

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["debugging:admin"],
    ...overrides
  };
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

describe("reload configuration service", () => {
  beforeEach(() => {
    vi.mocked(createAuditEvent).mockClear();
  });

  it("refuses viewers without debugging:admin", async () => {
    const { db } = createFakeDb();
    await expect(
      getReloadConfigurationAdminView(db, auth({ permissions: ["debugging:view"] }))
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:admin" }
    });
    await expect(
      updateOrganisationReloadConfiguration(db, auth({ permissions: ["debugging:view"] }), SEEDED_RELOAD_CONFIGURATION)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:admin" }
    });
  });

  it("refuses an agent actor on configuration write and audits dts-reload-agent-refused", async () => {
    const { db } = createFakeDb();
    await expect(
      updateOrganisationReloadConfiguration(db, auth(), SEEDED_RELOAD_CONFIGURATION, {
        actorType: "agent",
        requestId: "req-config-agent"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: {
        code: "dts-reload-agent-refused",
        reason: "agent-refused",
        requireHuman: true,
        action: "configure"
      }
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        kind: "dts-reload-agent-refused",
        action: "deny",
        metadata: expect.objectContaining({
          code: "dts-reload-agent-refused",
          reason: "agent-refused",
          requireHuman: true,
          action: "configure"
        })
      })
    );
    expect(createAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "dts-reload-configuration-update" })
    );
  });

  it("returns seeded organisation defaults when no row exists", async () => {
    const { db } = createFakeDb([[], []]);
    const view = await getReloadConfigurationAdminView(db, auth());
    expect(view.organisation).toMatchObject({
      scope: "organisation",
      source: "seeded-default",
      ...SEEDED_RELOAD_CONFIGURATION,
      updatedAt: null
    });
    expect(view.deviceOverrides).toEqual([]);
  });

  it("updates organisation defaults, validates the log command, and writes audit evidence", async () => {
    const saved = orgRow({
      destination_directory: "/oem/firmware/",
      kernel_log_command: "hilog"
    });
    const { db } = createFakeDb([
      [orgRow()],
      [saved]
    ]);

    const next = await updateOrganisationReloadConfiguration(
      db,
      auth(),
      {
        destinationDirectory: "/oem/firmware/",
        destinationFilename: "power_dts_overlay.dtbo",
        triggerNodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
        triggerPayload: "1",
        kernelLogCommand: "hilog"
      },
      { requestId: "req-1" }
    );

    expect(next.source).toBe("organisation");
    expect(next.destinationDirectory).toBe("/oem/firmware/");
    expect(next.kernelLogCommand).toBe("hilog");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-configuration-update",
        action: "update",
        actorUserId: "user-1",
        targetType: "dts-reload-configuration",
        metadata: expect.objectContaining({
          scope: "organisation",
          previous: expect.objectContaining({ kernelLogCommand: "dmesg" }),
          next: expect.objectContaining({ kernelLogCommand: "hilog" })
        })
      })
    );
  });

  it("rejects a disallowed kernel log command on save", async () => {
    const { db } = createFakeDb();
    await expect(
      updateOrganisationReloadConfiguration(db, auth(), {
        ...SEEDED_RELOAD_CONFIGURATION,
        kernelLogCommand: "bash -c id"
      })
    ).rejects.toBeInstanceOf(ApiError);
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("upserts a per-device override for a known device and audits previous/next values", async () => {
    const { db } = createFakeDb([
      [{ id: "device-1", name: "Aurora-A" }],
      [],
      [
        {
          id: "override-1",
          organization_id: "org-1",
          device_id: "device-1",
          destination_directory: "/data/vendor/firmware/",
          destination_filename: "power_dts_overlay.dtbo",
          trigger_node_path: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
          trigger_payload: "1",
          kernel_log_command: "cat /proc/kmsg",
          updated_by_user_id: "user-1",
          updated_at: "2026-08-10T03:00:00.000Z",
          created_at: "2026-08-10T03:00:00.000Z"
        }
      ]
    ]);

    const item = await upsertDeviceReloadConfiguration(
      db,
      auth(),
      "device-1",
      {
        ...SEEDED_RELOAD_CONFIGURATION,
        destinationDirectory: "/data/vendor/firmware/",
        kernelLogCommand: "cat /proc/kmsg"
      },
      { requestId: "req-2" }
    );

    expect(item).toMatchObject({
      scope: "device",
      deviceId: "device-1",
      deviceName: "Aurora-A",
      destinationDirectory: "/data/vendor/firmware/",
      kernelLogCommand: "cat /proc/kmsg"
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          scope: "device",
          deviceId: "device-1",
          previous: null,
          next: expect.objectContaining({ destinationDirectory: "/data/vendor/firmware/" })
        })
      })
    );
  });

  it("refuses a device override for an unknown device", async () => {
    const { db } = createFakeDb([[]]);
    await expect(
      upsertDeviceReloadConfiguration(db, auth(), "missing-device", SEEDED_RELOAD_CONFIGURATION)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes a device override and audits the removal", async () => {
    const { db } = createFakeDb([
      [
        {
          id: "override-1",
          organization_id: "org-1",
          device_id: "device-1",
          destination_directory: "/data/vendor/firmware/",
          destination_filename: "power_dts_overlay.dtbo",
          trigger_node_path: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
          trigger_payload: "1",
          kernel_log_command: "dmesg",
          updated_by_user_id: "user-1",
          updated_at: "2026-08-10T03:00:00.000Z",
          created_at: "2026-08-10T03:00:00.000Z"
        }
      ]
    ]);

    await expect(removeDeviceReloadConfiguration(db, auth(), "device-1", { requestId: "req-3" })).resolves.toEqual({
      deviceId: "device-1"
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-configuration-delete",
        action: "delete",
        metadata: expect.objectContaining({
          scope: "device",
          previous: expect.objectContaining({ destinationDirectory: "/data/vendor/firmware/" }),
          next: null
        })
      })
    );
  });
});
