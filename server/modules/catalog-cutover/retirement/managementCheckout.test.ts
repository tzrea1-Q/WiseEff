import { EventEmitter } from "node:events";
import type pg from "pg";
import { expect, it, vi } from "vitest";
import { acquireObservedManagementClient } from "./managementCheckout";

const secret = "private-management-password";
function fixture(fault: "none" | "callback-error" | "synchronous-throw" | "disconnect-before-return" | "disconnect-next-microtask") {
  const client = Object.assign(new EventEmitter(), { release: vi.fn() });
  const onError = vi.fn();
  const pool = { connect(callback?: (error: Error | undefined, value?: unknown) => void) {
    if (fault === "synchronous-throw") throw new Error(secret);
    if (!callback) return Promise.resolve(client);
    if (fault === "callback-error") { callback(new Error(secret)); return; }
    callback(undefined, client);
    if (fault === "disconnect-before-return") client.emit("error", new Error(secret));
    if (fault === "disconnect-next-microtask") queueMicrotask(() => client.emit("error", new Error(secret)));
  } } as unknown as pg.Pool;
  return { client, pool, onError };
}

it("observes the client before the pool acquisition callback returns and through destruction", async () => {
  const value = fixture("none");
  const client = await acquireObservedManagementClient(value.pool, value.onError);
  expect(client).toBe(value.client);
  value.client.emit("error", new Error(secret));
  expect(value.onError).toHaveBeenCalledOnce();
  expect(value.client.release).not.toHaveBeenCalled();
});

it.each(["callback-error", "synchronous-throw", "disconnect-before-return", "disconnect-next-microtask"] as const)("rejects and redacts %s without leaking the lease", async fault => {
  const value = fixture(fault);
  await expect(acquireObservedManagementClient(value.pool, value.onError)).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-CONNECTION-FAILED");
  if (fault.startsWith("disconnect")) {
    expect(value.client.release).toHaveBeenCalledExactlyOnceWith(true);
    // A destroying client can emit another error before its end event.
    expect(() => value.client.emit("error", new Error(secret))).not.toThrow();
  } else expect(value.client.release).not.toHaveBeenCalled();
});
