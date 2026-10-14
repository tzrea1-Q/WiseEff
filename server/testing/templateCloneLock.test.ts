import { afterEach, expect, it, vi } from "vitest";
import { withTempDatabase } from "./tempDatabase";
import { withTestClusterRoleCatalogLock } from "./testDatabase";

const postgres = vi.hoisted(() => ({
  locks: new Map<number, Array<() => void>>(),
  databases: new Set<string>(),
  query: vi.fn(),
}));

vi.mock("pg", () => ({ default: {
  escapeIdentifier: (name: string) => `"${name}"`,
  Client: class {
    connect = vi.fn(async () => undefined);
    end = vi.fn(async () => undefined);
    query = async (text: string, values: unknown[] = []) => {
      await postgres.query(text, values);
      const lock = values[0] as number;
      if (text === "select pg_advisory_lock($1)") {
        const queue = postgres.locks.get(lock);
        if (queue) await new Promise<void>((resolve) => queue.push(resolve));
        else postgres.locks.set(lock, []);
      }
      if (text === "select pg_advisory_unlock($1)") {
        const queue = postgres.locks.get(lock)!;
        if (queue.length) queue.shift()!();
        else postgres.locks.delete(lock);
      }
      if (text.includes("select true as ok from pg_database")) {
        const name = values[0] as string;
        return { rows: name.includes("_test_tpl_") || postgres.databases.has(name) ? [{ ok: true }] : [], rowCount: 1 };
      }
      if (text.startsWith("create database ")) postgres.databases.add(text.split(" ")[2]);
      return { rows: [], rowCount: 0 };
    };
  },
} }));

afterEach(() => {
  expect(postgres.locks.size).toBe(0);
  postgres.databases.clear();
  postgres.query.mockReset();
});

it("serializes only CREATE DATABASE, allowing the next ready clone during another worker's role callback", async () => {
  let releaseCopy!: () => void;
  let copied!: () => void;
  let releaseCallback!: () => void;
  let entered!: () => void;
  const copyBlocked = new Promise<void>((resolve) => { releaseCopy = resolve; });
  const copyStarted = new Promise<void>((resolve) => { copied = resolve; });
  const callbackBlocked = new Promise<void>((resolve) => { releaseCallback = resolve; });
  const callbackStarted = new Promise<void>((resolve) => { entered = resolve; });
  postgres.query.mockImplementation(async (text: string) => {
    if (text.startsWith("create database ") && text.includes("_efirst_")) {
      copied();
      await copyBlocked;
    }
  });
  const first = withTestClusterRoleCatalogLock(() => withTempDatabase({ prefix: "first" }, async () => {
    entered();
    await callbackBlocked;
  }));
  try {
    await copyStarted;
    expect(postgres.locks.has(4_201_660)).toBe(true);
    const second = withTempDatabase({ prefix: "second" }, async () => {
      expect(postgres.locks.has(4_201_660)).toBe(false);
      expect(postgres.locks.has(4_201_659)).toBe(true);
    });
    await vi.waitFor(() => expect(postgres.locks.get(4_201_660)).toHaveLength(1));
    expect(postgres.query.mock.calls.some(([text]) => text.startsWith("create database ") && text.includes("_esecond_"))).toBe(false);
    releaseCopy();
    await callbackStarted;
    await second;
  } finally {
    releaseCopy();
    releaseCallback();
    await first;
  }
  expect(postgres.query).toHaveBeenCalledWith("select set_config('lock_timeout', $1, false)", ["120000ms"]);
  expect(postgres.query).toHaveBeenCalledWith("reset lock_timeout", []);
  expect(postgres.query.mock.calls.filter(([text]) => text.startsWith("create database "))).toHaveLength(2);
});

it("retains the bounded lock wait and resets lock_timeout when clone acquisition fails", async () => {
  postgres.query.mockImplementation(async (text: string) => {
    if (text === "select pg_advisory_lock($1)") throw new Error("lock timeout");
  });
  const callback = vi.fn();
  await expect(withTempDatabase({ prefix: "locktimeout" }, callback)).rejects.toThrow("lock timeout");
  expect(callback).not.toHaveBeenCalled();
  expect(postgres.query).toHaveBeenCalledWith("select set_config('lock_timeout', $1, false)", ["120000ms"]);
  expect(postgres.query).toHaveBeenLastCalledWith("reset lock_timeout", []);
});
