import { expect, it } from "vitest";
import { createDatabaseCleanup } from "../server/testing/databaseCleanup";

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
