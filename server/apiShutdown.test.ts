import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { createApiShutdown } from "./apiShutdown";

it("stops HTTP admission and waits for every worker before closing either pool", async () => {
  let response!: ServerResponse;
  let received!: () => void;
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const server = createServer((_request, incoming) => { response = incoming; received(); });
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
    response.end("ok");
    expect(await request).toBe("ok");
    await closing;
    expect(stop).toHaveBeenCalledOnce();
    expect(application).toHaveBeenCalledOnce();
    expect(governance).toHaveBeenCalledOnce();
  } finally { finish(); response.end(); await request; await closing; }
});

it("settles all shutdown steps after synchronous and asynchronous failures without exposing private errors", async () => {
  const secret = new Error("private connection credential");
  let finish!: () => void;
  const active = new Promise<void>(resolve => { finish = resolve; });
  const pool = vi.fn(async () => { throw secret; });
  const otherPool = vi.fn(async () => {});
  const shutdown = createApiShutdown({ server: createServer(),
    workers: [() => { throw secret; }, () => active], pools: [pool, otherPool] });
  const closing = shutdown().catch(error => error);
  await Promise.resolve();
  expect(pool).not.toHaveBeenCalled();
  finish();
  expect(await closing).toEqual(new Error("PCAT-RUNTIME-API-SHUTDOWN-FAILED"));
  expect(pool).toHaveBeenCalledOnce();
  expect(otherPool).toHaveBeenCalledOnce();
});
