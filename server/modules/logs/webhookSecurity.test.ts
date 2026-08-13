import { describe, expect, it } from "vitest";

import {
  isBlockedWebhookAddress,
  signWebhookPayload,
  validateWebhookUrl,
  verifyWebhookSignature
} from "./webhookSecurity";

describe("validateWebhookUrl", () => {
  it("accepts a public https URL", () => {
    const result = validateWebhookUrl("https://hooks.example.com/wiseeff?channel=ops");
    expect(result.ok).toBe(true);
  });

  it("rejects malformed URLs", () => {
    const result = validateWebhookUrl("not a url");
    expect(result).toMatchObject({ ok: false, reason: "webhook-url-invalid" });
  });

  it("rejects plain http by default", () => {
    const result = validateWebhookUrl("http://hooks.example.com/wiseeff");
    expect(result).toMatchObject({ ok: false, reason: "webhook-url-scheme" });
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of ["ftp://example.com/x", "file:///etc/passwd", "gopher://example.com"]) {
      expect(validateWebhookUrl(url)).toMatchObject({ ok: false, reason: "webhook-url-scheme" });
    }
  });

  it("rejects embedded credentials", () => {
    const result = validateWebhookUrl("https://user:pass@hooks.example.com/wiseeff");
    expect(result).toMatchObject({ ok: false, reason: "webhook-url-credentials" });
  });

  // The SSRF rejection matrix: every private / loopback / link-local / metadata
  // range from the security spec must be rejected as a URL host literal.
  const blockedHosts = [
    "0.0.0.0", // 0.0.0.0/8
    "10.1.2.3", // 10/8
    "100.64.10.10", // 100.64/10 CGNAT
    "127.0.0.1", // 127/8 loopback
    "127.8.8.8",
    "169.254.169.254", // 169.254/16 link-local + cloud metadata
    "172.16.0.9", // 172.16/12
    "172.31.255.1",
    "192.0.0.10", // 192.0.0.0/24
    "192.168.1.1", // 192.168/16
    "198.18.0.1", // 198.18/15 benchmarking
    "224.0.0.251", // multicast
    "255.255.255.255", // broadcast
    "[::1]", // IPv6 loopback
    "[::]", // unspecified
    "[fc00::1]", // fc00::/7 unique local
    "[fdff::9]",
    "[fe80::1]", // fe80::/10 link-local
    "[ff02::1]", // multicast
    "[::ffff:10.0.0.5]", // IPv4-mapped private
    "[::ffff:127.0.0.1]"
  ];

  it.each(blockedHosts)("rejects https://%s as a private/loopback/metadata address", (host) => {
    const result = validateWebhookUrl(`https://${host}/hook`);
    expect(result).toMatchObject({ ok: false, reason: "webhook-url-private-address" });
  });

  it("allows http://127.0.0.1 only behind the local-development flag", () => {
    expect(validateWebhookUrl("http://127.0.0.1:9999/hook")).toMatchObject({ ok: false, reason: "webhook-url-scheme" });
    expect(validateWebhookUrl("http://127.0.0.1:9999/hook", { allowInsecureLocal: true }).ok).toBe(true);
    // The flag stays scoped to loopback: plain http to anything else is still refused.
    expect(validateWebhookUrl("http://10.0.0.8/hook", { allowInsecureLocal: true })).toMatchObject({
      ok: false,
      reason: "webhook-url-scheme"
    });
    expect(validateWebhookUrl("http://hooks.example.com/hook", { allowInsecureLocal: true })).toMatchObject({
      ok: false,
      reason: "webhook-url-scheme"
    });
  });

  it("keeps rejecting non-loopback private literals even with the local flag", () => {
    expect(validateWebhookUrl("https://192.168.1.1/hook", { allowInsecureLocal: true })).toMatchObject({
      ok: false,
      reason: "webhook-url-private-address"
    });
  });
});

describe("isBlockedWebhookAddress", () => {
  it("blocks resolved private and special-range addresses", () => {
    for (const address of [
      "0.1.2.3",
      "10.0.0.1",
      "100.127.0.1",
      "127.0.0.53",
      "169.254.0.1",
      "172.20.0.1",
      "192.168.0.10",
      "198.19.4.4",
      "225.1.1.1",
      "240.0.0.1",
      "::1",
      "fc00::2",
      "fe80::abcd",
      "ff05::2",
      "::ffff:192.168.0.1"
    ]) {
      expect(isBlockedWebhookAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isBlockedWebhookAddress(address), address).toBe(false);
    }
  });

  it("treats unparseable addresses as blocked", () => {
    expect(isBlockedWebhookAddress("bananas")).toBe(true);
  });

  it("permits loopback only with the local-development flag", () => {
    expect(isBlockedWebhookAddress("127.0.0.1", { allowInsecureLocal: true })).toBe(false);
    expect(isBlockedWebhookAddress("::1", { allowInsecureLocal: true })).toBe(false);
    expect(isBlockedWebhookAddress("10.0.0.1", { allowInsecureLocal: true })).toBe(true);
  });
});

describe("webhook signature", () => {
  const secret = "acceptance-webhook-secret-0123456789";
  const rawBody = JSON.stringify({ event: "log-analysis.completed", recordId: "log-1" });

  it("signs timestamp + raw body and verifies within the replay window", () => {
    const timestampSeconds = 1_755_000_000;
    const header = signWebhookPayload({ secret, timestampSeconds, rawBody });
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature({
        secret,
        timestampSeconds,
        rawBody,
        signatureHeader: header,
        nowSeconds: timestampSeconds + 60
      })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestampSeconds = 1_755_000_000;
    const header = signWebhookPayload({ secret, timestampSeconds, rawBody });
    expect(
      verifyWebhookSignature({
        secret,
        timestampSeconds,
        rawBody: `${rawBody} `,
        signatureHeader: header,
        nowSeconds: timestampSeconds
      })
    ).toBe(false);
  });

  it("rejects a replayed timestamp outside the tolerance window", () => {
    const timestampSeconds = 1_755_000_000;
    const header = signWebhookPayload({ secret, timestampSeconds, rawBody });
    expect(
      verifyWebhookSignature({
        secret,
        timestampSeconds,
        rawBody,
        signatureHeader: header,
        nowSeconds: timestampSeconds + 301
      })
    ).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    const timestampSeconds = 1_755_000_000;
    const header = signWebhookPayload({ secret: "another-secret-that-is-long-enough", timestampSeconds, rawBody });
    expect(
      verifyWebhookSignature({ secret, timestampSeconds, rawBody, signatureHeader: header, nowSeconds: timestampSeconds })
    ).toBe(false);
  });
});
