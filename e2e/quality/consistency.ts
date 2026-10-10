import type { BrowserContext } from "playwright/test";

export async function installConsistencyReadGuard(context: BrowserContext) {
  const blocked: { method: string; pathname: string }[] = [];
  await context.route("**/*", async (intercepted) => {
    const request = intercepted.request();
    if (request.method() === "GET") {
      await intercepted.fallback();
      return;
    }
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname === "/api/v1/device-bridges/pairing-codes") {
      await intercepted.fulfill({
        status: 201,
        json: { code: "000000", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
      });
      return;
    }
    blocked.push({ method: request.method(), pathname });
    await intercepted.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  return blocked;
}
