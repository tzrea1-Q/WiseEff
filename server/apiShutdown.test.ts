import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { createApiShutdown } from "./apiShutdown";
import { createHttpServer } from "./shared/http/server";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";

it("keeps pools open for an accepted handler after its client disconnects", async () => {
  let finish!: () => void;
  let received!: () => void;
  const active = new Promise<void>(resolve => { finish = resolve; });
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const writes: string[] = [];
  const pool = vi.fn(async () => { writes.push("pool-closed"); });
  const server = createHttpServer({ async handle() {
    received(); await active; writes.push("handler-write");
    return { status: 200, body: { ok: true } };
  } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const abort = new AbortController();
  const request = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { signal: abort.signal }).catch(() => undefined);
  await arrived;
  abort.abort(); await request;
  const closed = once(server, "close");
  const shutdown = createApiShutdown({ server, workers: [], pools: [pool] });
  const closing = shutdown();
  try {
    await closed; await setImmediate();
    expect(pool).not.toHaveBeenCalled();
    finish(); await closing;
    expect(writes).toEqual(["handler-write", "pool-closed"]);
  } finally { finish(); await closing; }
});

it("stops HTTP admission and waits for every worker before closing either pool", async () => {
  let respond!: () => void;
  const response = new Promise<void>(resolve => { respond = resolve; });
  let received!: () => void;
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const server = createHttpServer({ async handle() {
    received(); await response;
    return { status: 200, text: "ok", contentType: "text/plain" };
  } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`).then(result => result.text());
  await arrived;
  let finish!: () => void;
  const active = new Promise<void>(resolve => { finish = resolve; });
  const stop = vi.fn(() => active);
  const application = vi.fn(async () => {});
  const governance = vi.fn(async () => {});
  const shutdown = createApiShutdown({ server, workers: [stop], pools: [application, governance] });
  const closing = shutdown();
  expect(shutdown()).toBe(closing);
  try {
    await vi.waitFor(() => expect(server.listening).toBe(false));
    expect(application).not.toHaveBeenCalled();
    expect(governance).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
    expect(application).not.toHaveBeenCalled();
    respond();
    expect(await request).toBe("ok");
    await closing;
    expect(stop).toHaveBeenCalledOnce();
    expect(application).toHaveBeenCalledOnce();
    expect(governance).toHaveBeenCalledOnce();
  } finally { finish(); respond(); await request; await closing; }
});

it("settles all shutdown steps after synchronous and asynchronous failures without exposing private errors", async () => {
  const secret = new Error("private connection credential");
  let finish!: () => void;
  const active = new Promise<void>(resolve => { finish = resolve; });
  const pool = vi.fn(async () => { throw secret; });
  const otherPool = vi.fn(async () => {});
  const shutdown = createApiShutdown({ server: createHttpServer({ async handle() { return { status: 204, body: {} }; } }),
    workers: [() => { throw secret; }, () => active], pools: [pool, otherPool] });
  const closing = shutdown().catch(error => error);
  await Promise.resolve();
  expect(pool).not.toHaveBeenCalled();
  finish();
  expect(await closing).toEqual(new Error("PCAT-RUNTIME-API-SHUTDOWN-FAILED"));
  expect(pool).toHaveBeenCalledOnce();
  expect(otherPool).toHaveBeenCalledOnce();
});
