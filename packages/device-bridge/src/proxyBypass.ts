function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isIpv4Address(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function parseNoProxyEntries() {
  const raw = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function hostMatchesNoProxy(hostname: string, entries: string[]) {
  const normalized = hostname.toLowerCase();
  for (const entry of entries) {
    const pattern = entry.toLowerCase();
    if (!pattern) {
      continue;
    }
    if (pattern === "*") {
      return true;
    }
    if (pattern.startsWith(".")) {
      const bare = pattern.slice(1);
      if (normalized === bare || normalized.endsWith(pattern)) {
        return true;
      }
      continue;
    }
    if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

export function shouldBypassProxyForUrl(targetUrl: string, serverUrl?: string) {
  try {
    const { hostname } = new URL(targetUrl);
    if (isLoopbackHost(hostname) || isIpv4Address(hostname)) {
      return true;
    }
    if (serverUrl) {
      const serverHost = new URL(serverUrl).hostname;
      if (hostname === serverHost) {
        return true;
      }
    }
    if (hostMatchesNoProxy(hostname, parseNoProxyEntries())) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
