const LOCAL_BRIDGE_ORIGIN = "http://127.0.0.1:18787";

export function resolveLocalBridgeUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV) {
    return `/local-bridge${normalizedPath}`;
  }
  return `${LOCAL_BRIDGE_ORIGIN}${normalizedPath}`;
}

export function resolveLocalBridgeHealthUrl() {
  return resolveLocalBridgeUrl("/health");
}
