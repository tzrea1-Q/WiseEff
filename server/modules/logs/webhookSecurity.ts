import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * Webhook security primitives (P3b): SSRF validation for admin-configured result
 * webhook URLs and HMAC-SHA256 payload signing.
 *
 * SSRF stance (docs/SECURITY.md): a webhook URL is admin-supplied but still
 * untrusted — it must never let the server reach loopback, private, link-local,
 * or cloud-metadata address space. Validation happens BOTH at configuration save
 * (clear error codes for admins) and at delivery time (the connection itself uses
 * a validating DNS lookup, so a hostname cannot re-resolve to a private address
 * between check and connect).
 */

export type WebhookUrlRejection =
  | "webhook-url-invalid"
  | "webhook-url-scheme"
  | "webhook-url-credentials"
  | "webhook-url-private-address";

export type WebhookUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: WebhookUrlRejection; message: string };

export type WebhookSsrfOptions = {
  /**
   * Local-development escape hatch (LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true):
   * additionally allows plain-http loopback URLs (e.g. http://127.0.0.1:9999)
   * so integrators can test against a local receiver. Default off.
   */
  allowInsecureLocal?: boolean;
};

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : null;
}

function isBlockedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) {
    return true;
  }
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + broadcast
  return false;
}

function isLoopbackIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  return octets !== null && octets[0] === 127;
}

function expandIpv6(address: string): string[] | null {
  const stripped = address.split("%")[0].toLowerCase();
  const doubleColonParts = stripped.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }
  const head = doubleColonParts[0] === "" ? [] : doubleColonParts[0].split(":");
  const tail = doubleColonParts.length === 2 && doubleColonParts[1] !== "" ? doubleColonParts[1].split(":") : [];
  // An embedded IPv4 tail (e.g. ::ffff:127.0.0.1) counts as two 16-bit groups.
  const tailGroups = tail.length > 0 && tail[tail.length - 1].includes(".") ? tail.length + 1 : tail.length;
  const missing = 8 - head.length - tailGroups;
  if (doubleColonParts.length === 2 && missing < 0) {
    return null;
  }
  const groups = doubleColonParts.length === 2 ? [...head, ...Array(Math.max(0, missing)).fill("0"), ...tail] : head;
  return groups;
}

/**
 * Extracts an embedded IPv4 address from an IPv6 string: both dotted forms
 * (::ffff:10.0.0.5) and the hex form URL parsers normalize to (::ffff:a00:5).
 */
function embeddedIpv4Of(address: string): string | null {
  const dotted = address.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    return dotted[1];
  }
  const groups = expandIpv6(address);
  if (!groups || groups.length !== 8) {
    return null;
  }
  const normalized = groups.map((group) => Number.parseInt(group || "0", 16));
  const isMappedPrefix = normalized.slice(0, 5).every((group) => group === 0) && normalized[5] === 0xffff;
  if (!isMappedPrefix) {
    return null;
  }
  const high = normalized[6];
  const low = normalized[7];
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function isBlockedIpv6(address: string): boolean {
  const stripped = address.split("%")[0].toLowerCase();
  // IPv4-mapped/compatible forms delegate to the IPv4 ranges.
  const embeddedIpv4 = embeddedIpv4Of(stripped);
  if (embeddedIpv4) {
    return isBlockedIpv4(embeddedIpv4);
  }
  const groups = expandIpv6(stripped);
  if (!groups) {
    return true;
  }
  const first = Number.parseInt(groups[0] || "0", 16);
  const normalized = groups.map((group) => Number.parseInt(group || "0", 16));
  if (normalized.every((group) => group === 0)) return true; // :: unspecified
  if (normalized.slice(0, 7).every((group) => group === 0) && normalized[7] === 1) return true; // ::1 loopback
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isLoopbackIpv6(address: string): boolean {
  const stripped = address.split("%")[0].toLowerCase();
  if (stripped === "::1") return true;
  const embeddedIpv4 = embeddedIpv4Of(stripped);
  return embeddedIpv4 ? isLoopbackIpv4(embeddedIpv4) : false;
}

/**
 * Address-level SSRF check used by the validating DNS lookup at delivery time.
 * Returns true when the resolved address must NOT be connected to.
 */
export function isBlockedWebhookAddress(address: string, options: WebhookSsrfOptions = {}): boolean {
  const family = isIP(address);
  if (family === 4) {
    if (options.allowInsecureLocal && isLoopbackIpv4(address)) {
      return false;
    }
    return isBlockedIpv4(address);
  }
  if (family === 6) {
    if (options.allowInsecureLocal && isLoopbackIpv6(address)) {
      return false;
    }
    return isBlockedIpv6(address);
  }
  return true;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * URL-shape SSRF validation shared by configuration save and delivery:
 * https-only (http allowed for loopback hosts only behind the dev flag), no
 * embedded credentials, and IP-literal hosts checked against the blocked ranges.
 * Hostname resolution is enforced separately by the validating lookup.
 */
export function validateWebhookUrl(rawUrl: string, options: WebhookSsrfOptions = {}): WebhookUrlValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "webhook-url-invalid", message: "Webhook URL is not a valid absolute URL." };
  }

  const host = stripBrackets(url.hostname);
  const hostFamily = isIP(host);
  const isLoopbackLiteral = hostFamily === 4 ? isLoopbackIpv4(host) : hostFamily === 6 ? isLoopbackIpv6(host) : false;

  if (url.protocol !== "https:") {
    if (!(options.allowInsecureLocal && url.protocol === "http:" && isLoopbackLiteral)) {
      return {
        ok: false,
        reason: "webhook-url-scheme",
        message: "Webhook URL must use https: (plain http is only allowed for 127.0.0.1 when LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true)."
      };
    }
  }

  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "webhook-url-credentials", message: "Webhook URL must not embed credentials." };
  }

  if (hostFamily !== 0 && isBlockedWebhookAddress(host, options)) {
    return {
      ok: false,
      reason: "webhook-url-private-address",
      message: "Webhook URL points at a private, loopback, link-local, or metadata address range."
    };
  }

  return { ok: true, url };
}

export const WEBHOOK_SIGNATURE_HEADER = "x-wiseeff-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-wiseeff-timestamp";

/**
 * HMAC-SHA256 over `${timestampSeconds}.${rawBody}`, sent as
 * `X-WiseEff-Signature: sha256=<hex>` next to `X-WiseEff-Timestamp`.
 * Signing the timestamp together with the raw body is what makes the timestamp
 * header an actual replay defence — an unsigned timestamp could be rewritten.
 */
export function signWebhookPayload(input: { secret: string; timestampSeconds: number; rawBody: string }): string {
  const digest = createHmac("sha256", input.secret).update(`${input.timestampSeconds}.${input.rawBody}`).digest("hex");
  return `sha256=${digest}`;
}

/** Receiver-side helper mirrored in the integration guide (also used by tests). */
export function verifyWebhookSignature(input: {
  secret: string;
  timestampSeconds: number;
  rawBody: string;
  signatureHeader: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestampSeconds) > tolerance) {
    return false;
  }
  const expected = signWebhookPayload({
    secret: input.secret,
    timestampSeconds: input.timestampSeconds,
    rawBody: input.rawBody
  });
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signatureHeader);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
