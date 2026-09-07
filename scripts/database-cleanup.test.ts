import { expect, it, vi } from "vitest";
import { createDatabaseCleanup, createDatabaseCleanupTrace } from "../server/testing/databaseCleanup";

it("makes every concurrent close await the same actual cleanup before reporting success", async () => {
  let finish!: () => void, calls = 0;
  const cleanup = createDatabaseCleanup(() => { calls++; return new Promise<void>(resolve => { finish = resolve; }); });
  const first = cleanup.close(), second = cleanup.close();
  let secondDone = false; void second.then(() => { secondDone = true; });
  await Promise.resolve();
  expect(secondDone).toBe(false);
  expect(cleanup.closed).toBe(false);
  expect(calls).toBe(1);
  finish(); await Promise.all([first, second]);
  expect(cleanup.closed).toBe(true);
  await cleanup.close(); expect(calls).toBe(1);
});

it("retains failure and the original error for all waiters, then permits only an explicit retry", async () => {
  const original = new Error("synthetic-cleanup-failure");
  let reject!: (error: Error) => void, calls = 0;
  const remaining = new Set(["owned-database"]);
  const cleanup = createDatabaseCleanup(async () => {
    calls++;
    if (calls === 1) await new Promise<void>((_resolve, fail) => { reject = fail; });
    remaining.delete("owned-database");
  });
  const first = cleanup.close(), second = cleanup.close();
  const firstFailure = expect(first).rejects.toBe(original), secondFailure = expect(second).rejects.toBe(original);
  await Promise.resolve(); reject(original);
  await Promise.all([firstFailure, secondFailure]);
  expect(cleanup.closed).toBe(false);
  expect([...remaining]).toEqual(["owned-database"]);
  expect(calls).toBe(1);
  await cleanup.close();
  expect(cleanup.closed).toBe(true); expect(remaining.size).toBe(0); expect(calls).toBe(2);
});

it("releases a synchronously failed attempt without replacing its original rejection", async () => {
  const original = { kind: "synthetic-original-failure" };
  let calls = 0;
  const cleanup = createDatabaseCleanup(() => {
    if (++calls === 1) throw original;
    return Promise.resolve();
  });
  const first = cleanup.close(), second = cleanup.close();
  await expect(first).rejects.toBe(original);
  await expect(second).rejects.toBe(original);
  expect(cleanup.pending).toBe(false); expect(cleanup.closed).toBe(false); expect(calls).toBe(1);
  await cleanup.close(); expect(calls).toBe(2); expect(cleanup.closed).toBe(true);
});

it("reports the pending cleanup phase without database, SQL or error text and removes its timer", async () => {
  vi.useFakeTimers();
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  let finish!: () => void;
  try {
    const trace = createDatabaseCleanupTrace();
    const pending = trace("drop", () => new Promise<void>(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(output).toHaveBeenCalledTimes(1);
    const observed = JSON.parse(output.mock.calls[0][0]);
    expect(observed).toEqual({ kind: "test-database-cleanup", cleanupId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      phase: "drop", outcome: "pending", elapsedMs: expect.any(Number) });
    finish(); await pending;
    expect(output).toHaveBeenCalledTimes(2);
    expect(JSON.parse(output.mock.calls[1][0])).toMatchObject({ cleanupId: observed.cleanupId, phase: "drop", outcome: "completed" });
    expect(vi.getTimerCount()).toBe(0);
  } finally { output.mockRestore(); vi.useRealTimers(); }
});

it("keeps fast cleanup silent and reports private failures using only the static phase", async () => {
  vi.useFakeTimers();
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const privateError = new Error("postgres://private-user:private-password@private-target/private-database");
  try {
    const trace = createDatabaseCleanupTrace();
    expect(await trace("connect", async () => 7)).toBe(7);
    expect(output).not.toHaveBeenCalled();
    await expect(trace("end", async () => { throw privateError; })).rejects.toBe(privateError);
    expect(output).toHaveBeenCalledTimes(1);
    expect(output.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({ kind: "test-database-cleanup", cleanupId: expect.any(String),
      phase: "end", outcome: "failed", elapsedMs: expect.any(Number) });
    expect(output.mock.calls[0][0]).not.toContain("private-");
    expect(vi.getTimerCount()).toBe(0);
    output.mockImplementation(() => { throw new Error("diagnostic-stream-closed"); });
    await expect(trace("drop", async () => { throw privateError; })).rejects.toBe(privateError);
  } finally { output.mockRestore(); vi.useRealTimers(); }
});
