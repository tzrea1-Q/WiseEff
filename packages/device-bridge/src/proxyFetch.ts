import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type ProxyConfig = {
  proxyUrl?: string;
};

function resolveProxyConfigPath() {
  return path.join(os.homedir(), ".wiseeff", "proxy.json");
}

function envProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy
  );
}

export async function loadProxyConfig(): Promise<ProxyConfig> {
  try {
    const raw = await readFile(resolveProxyConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as ProxyConfig;
    if (parsed && typeof parsed.proxyUrl === "string" && parsed.proxyUrl) {
      return parsed;
    }
  } catch {
    // No proxy config file — that's fine, fall back to env.
  }
  return {};
}

function detectMacSystemProxy(): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const scutilPaths = ["/usr/sbin/scutil", "/usr/bin/scutil", "scutil"];
  for (const scutil of scutilPaths) {
    try {
      const output = execSync(`${scutil} --proxy`, { timeout: 3000, encoding: "utf8" });
      const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(output);
      const httpEnabled = /HTTPEnable\s*:\s*1/.test(output);
      if (!httpsEnabled && !httpEnabled) {
        return undefined;
      }
      const portMatch = output.match(/HTTPSPort\s*:\s*(\d+)/) ?? output.match(/HTTPPort\s*:\s*(\d+)/);
      const hostMatch = output.match(/HTTPSProxy\s*:\s*([\d.]+)/) ?? output.match(/HTTPProxy\s*:\s*([\d.]+)/);
      if (portMatch && hostMatch) {
        return `http://${hostMatch[1]}:${portMatch[1]}`;
      }
      return undefined;
    } catch {
      // scutil not available at this path — try next.
    }
  }
  return undefined;
}

export async function resolveProxyUrl(): Promise<string | undefined> {
  const envUrl = envProxyUrl();
  if (envUrl) {
    return envUrl;
  }
  const config = await loadProxyConfig();
  if (config.proxyUrl) {
    return config.proxyUrl;
  }
  return detectMacSystemProxy();
}

let cachedDispatcher: unknown = null;
let cachedProxyUrl: string | undefined = undefined;

async function getProxyDispatcher(proxyUrl: string): Promise<unknown> {
  if (cachedDispatcher && cachedProxyUrl === proxyUrl) {
    return cachedDispatcher;
  }
  const mod = await import("undici");
  const dispatcher = new mod.ProxyAgent(proxyUrl);
  cachedDispatcher = dispatcher;
  cachedProxyUrl = proxyUrl;
  return dispatcher;
}

import { shouldBypassProxyForUrl } from "./proxyBypass";

export type ProxiedFetch = typeof fetch & { proxyUrl?: string };

export { shouldBypassProxyForUrl } from "./proxyBypass";

export async function createProxiedFetch(options?: { serverUrl?: string }): Promise<ProxiedFetch> {
  const proxyUrl = await resolveProxyUrl();
  if (!proxyUrl) {
    return fetch as ProxiedFetch;
  }

  let dispatcher: unknown;
  try {
    dispatcher = await getProxyDispatcher(proxyUrl);
  } catch {
    // If undici is unavailable (unlikely on Node 18+), fall back to plain fetch.
    return fetch as ProxiedFetch;
  }

  const proxiedFetch: ProxiedFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (shouldBypassProxyForUrl(requestUrl, options?.serverUrl)) {
      return fetch(input, init);
    }
    return fetch(input, { ...init, dispatcher } as RequestInit);
  };
  proxiedFetch.proxyUrl = proxyUrl;
  return proxiedFetch;
}
