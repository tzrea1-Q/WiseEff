export function buildConnectUrl(input: { server: string; code?: string; webOrigin?: string }) {
  const url = new URL("wiseeff-bridge://connect");
  url.searchParams.set("server", normalizeConnectServerUrl(input.server));
  if (input.webOrigin) {
    url.searchParams.set("webOrigin", normalizeConnectServerUrl(input.webOrigin));
  }
  if (input.code) {
    url.searchParams.set("code", input.code);
  }
  return url.toString();
}

export function buildInstallToolsUrl(input: { server: string; protocol?: "adb" | "hdc" | "all" }) {
  const url = new URL("wiseeff-bridge://install-tools");
  url.searchParams.set("server", normalizeConnectServerUrl(input.server));
  url.searchParams.set("protocol", input.protocol ?? "all");
  return url.toString();
}

function isInstallProtocol(value: string | null): value is "adb" | "hdc" | "all" {
  return value === "adb" || value === "hdc" || value === "all";
}

export function parseInstallToolsUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "wiseeff-bridge:" || url.hostname !== "install-tools") {
    throw new Error("Unsupported bridge URL");
  }
  const server = url.searchParams.get("server");
  const protocol = url.searchParams.get("protocol") ?? "all";
  if (!server) {
    throw new Error("Missing server");
  }
  if (!isAllowedConnectServerUrl(server)) {
    throw new Error("Server URL must use https or local http");
  }
  if (!isInstallProtocol(protocol)) {
    throw new Error("Protocol must be adb, hdc, or all");
  }
  return { server: normalizeConnectServerUrl(server), protocol };
}

export function buildInstallServiceUrl() {
  return "wiseeff-bridge://install-service";
}

export function parseInstallServiceUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "wiseeff-bridge:" || url.hostname !== "install-service") {
    throw new Error("Unsupported bridge URL");
  }
  return { kind: "install-service" as const };
}

export function parseBridgeUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "wiseeff-bridge:") {
    throw new Error("Unsupported bridge URL");
  }
  if (url.hostname === "connect") {
    return { kind: "connect" as const, ...parseConnectUrl(raw) };
  }
  if (url.hostname === "install-tools") {
    return { kind: "install-tools" as const, ...parseInstallToolsUrl(raw) };
  }
  if (url.hostname === "install-service") {
    return parseInstallServiceUrl(raw);
  }
  throw new Error("Unsupported bridge URL");
}

function isPairingCode(code: string) {
  return /^\d{6}$/.test(code);
}

function isIpv4Address(host: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
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
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return true;
    }
    // IP-mode deployments (pre-ICP HTTP) use plain http against a public IPv4 address.
    if (isIpv4Address(host)) {
      return true;
    }
  }
  return false;
}

export function parseConnectUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "wiseeff-bridge:" || url.hostname !== "connect") {
    throw new Error("Unsupported bridge URL");
  }
  const server = url.searchParams.get("server");
  const webOrigin = url.searchParams.get("webOrigin") ?? undefined;
  const code = url.searchParams.get("code") ?? undefined;
  if (!server) {
    throw new Error("Missing server");
  }
  if (!isAllowedConnectServerUrl(server)) {
    throw new Error("Server URL must use https or local http");
  }
  if (webOrigin !== undefined && !isAllowedConnectServerUrl(webOrigin)) {
    throw new Error("Web origin must use https or local http");
  }
  if (code !== undefined && !isPairingCode(code)) {
    throw new Error("Pairing code must be a 6-digit number");
  }
  return {
    server: normalizeConnectServerUrl(server),
    webOrigin: webOrigin ? normalizeConnectServerUrl(webOrigin) : undefined,
    code
  };
}
