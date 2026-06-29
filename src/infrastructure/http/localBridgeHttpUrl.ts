const LOCAL_BRIDGE_ORIGIN = "http://127.0.0.1:18787";

export function resolveLocalBridgeUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  // Use MODE, not DEV: root `.env` sets NODE_ENV=development which makes
  // import.meta.env.DEV true even during `vite build` production bundles.
  if (import.meta.env.MODE !== "production") {
    return `/local-bridge${normalizedPath}`;
  }
  return `${LOCAL_BRIDGE_ORIGIN}${normalizedPath}`;
}

export function resolveLocalBridgeHealthUrl() {
  return resolveLocalBridgeUrl("/health");
}

export function resolveLocalBridgeConnectUrl() {
  return resolveLocalBridgeUrl("/connect");
}
