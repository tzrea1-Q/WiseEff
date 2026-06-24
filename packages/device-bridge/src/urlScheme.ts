export function buildConnectUrl(input: { server: string; code?: string }) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", input.server);
  if (input.code) {
    url.searchParams.set("code", input.code);
  }
  return url.toString();
}

export function parseConnectUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "wiseeff-bridge:" || url.hostname !== "connect") {
    throw new Error("Unsupported bridge URL");
  }
  const server = url.searchParams.get("server");
  const code = url.searchParams.get("code") ?? undefined;
  if (!server) {
    throw new Error("Missing server");
  }
  return { server, code };
}
