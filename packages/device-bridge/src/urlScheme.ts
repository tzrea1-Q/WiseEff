export function buildConnectUrl(input: { server: string; code?: string }) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", normalizeConnectServerUrl(input.server));
  if (input.code) {
    url.searchParams.set("code", input.code);
  }
  return url.toString();
}

function isPairingCode(code: string) {
  return /^\d{6}$/.test(code);
}

export function normalizeConnectServerUrl(raw: string) {
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function isAllowedConnectServerUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol === "https:") {
    return true;
  }
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }
  return false;
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
  if (!isAllowedConnectServerUrl(server)) {
    throw new Error("Server URL must use https or local http");
  }
  if (code !== undefined && !isPairingCode(code)) {
    throw new Error("Pairing code must be a 6-digit number");
  }
  return { server: normalizeConnectServerUrl(server), code };
}
