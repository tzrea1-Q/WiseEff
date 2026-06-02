import type { Server } from "node:http";

export async function requestJson<Body = unknown>(server: Server, path: string, init: RequestInit = {}) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "test-request",
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const body = (text && contentType.includes("application/json") ? JSON.parse(text) : null) as Body;
    return { status: response.status, body, bodyText: text, headers: response.headers };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
