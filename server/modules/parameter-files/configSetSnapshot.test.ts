import { describe, expect, it, vi } from "vitest";
import { loadConfigSetSnapshot } from "./configSetSnapshot";
import type { ObjectStore } from "../logs/objectStore";

function makeDb(rows: Array<Record<string, unknown>>) {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length }))
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    config_set_id: "cs-1",
    file_id: "file-base",
    file_name: "base.dts",
    format: "dts",
    config_set_role: "base",
    config_set_sort_order: 0,
    current_version_id: "v-base",
    version_number: 3,
    storage_key: "key-base",
    ...overrides
  };
}

function makeObjectStore(contents: Record<string, string>): ObjectStore {
  return {
    get: vi.fn(async (key: string) => Buffer.from(contents[key] ?? "", "utf8")),
    put: vi.fn()
  } as never;
}

describe("loadConfigSetSnapshot", () => {
  it("loads members with contents in one pass and derives entry/overlay order", async () => {
    const db = makeDb([
      memberRow(),
      memberRow({
        file_id: "file-thermal",
        file_name: "thermal.dtso",
        config_set_role: "thermal",
        config_set_sort_order: 2,
        current_version_id: "v-thermal",
        storage_key: "key-thermal"
      }),
      memberRow({
        file_id: "file-charging",
        file_name: "charging.dtso",
        config_set_role: "charging",
        config_set_sort_order: 1,
        current_version_id: "v-charging",
        storage_key: "key-charging"
      }),
      memberRow({
        file_id: "file-json",
        file_name: "tuning.json",
        format: "json",
        config_set_role: "misc",
        config_set_sort_order: 3,
        current_version_id: "v-json",
        storage_key: "key-json"
      })
    ]);
    const objectStore = makeObjectStore({
      "key-base": "/dts-v1/;",
      "key-thermal": "&thermal {};",
      "key-charging": "&charging {};",
      "key-json": "{}"
    });

    const snapshot = await loadConfigSetSnapshot(db as never, objectStore, "cs-1");

    expect(snapshot.members.map((member) => member.fileName)).toEqual([
      "base.dts",
      "thermal.dtso",
      "charging.dtso",
      "tuning.json"
    ]);
    expect(snapshot.members[0].content).toBe("/dts-v1/;");
    expect(snapshot.entryFile).toBe("base.dts");
    expect(snapshot.overlayOrder).toEqual(["charging.dtso", "thermal.dtso"]);
    expect(snapshot.dtsFiles.map((file) => file.name)).toEqual(["base.dts", "thermal.dtso", "charging.dtso"]);
    expect(snapshot.toolchainFiles.get("charging.dtso")).toEqual({ content: "&charging {};" });
    expect([...snapshot.toolchainFiles.keys()]).not.toContain("tuning.json");
    expect(snapshot.skipped).toEqual([]);
  });

  it("skips members without a current version and reports them", async () => {
    const db = makeDb([
      memberRow(),
      memberRow({
        file_id: "file-pending",
        file_name: "pending.dts",
        current_version_id: null,
        version_number: null,
        storage_key: null
      })
    ]);
    const objectStore = makeObjectStore({ "key-base": "/dts-v1/;" });

    const snapshot = await loadConfigSetSnapshot(db as never, objectStore, "cs-1");

    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.skipped).toEqual([
      { fileId: "file-pending", fileName: "pending.dts", reason: "no-current-version" }
    ]);
  });

  it("falls back to the first DTS member as entry when no base role is annotated", async () => {
    const db = makeDb([
      memberRow({ config_set_role: "misc", file_name: "legacy.dts" }),
      memberRow({
        file_id: "file-2",
        file_name: "extra.dts",
        config_set_role: "misc",
        config_set_sort_order: 1,
        current_version_id: "v-2",
        storage_key: "key-2"
      })
    ]);
    const objectStore = makeObjectStore({ "key-base": "a", "key-2": "b" });

    const snapshot = await loadConfigSetSnapshot(db as never, objectStore, "cs-1");

    expect(snapshot.entryFile).toBe("legacy.dts");
    expect(snapshot.overlayOrder).toEqual(["legacy.dts", "extra.dts"]);
  });
});
