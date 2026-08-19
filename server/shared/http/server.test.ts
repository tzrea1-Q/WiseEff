import { describe, expect, it } from "vitest";
import { createHttpServer } from "./server";

describe("createHttpServer", () => {
  it("keeps idle sockets longer than Node's 5s default", () => {
    const server = createHttpServer({
      handle: async () => ({ status: 204, body: {} })
    });

    expect(server.keepAliveTimeout).toBeGreaterThanOrEqual(65_000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    server.close();
  });
});
