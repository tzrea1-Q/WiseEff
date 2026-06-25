import { describe, expect, it, vi } from "vitest";

import {
  buildBridgeToolInstallUrl,
  pollBridgeToolInstall,
  rememberBridgeToolInstallConfirm,
  shouldConfirmBridgeToolInstall
} from "./bridgeToolInstallLauncher";

describe("bridgeToolInstallLauncher", () => {
  it("builds install-tools scheme URL", () => {
    expect(buildBridgeToolInstallUrl("https://wiseeff.example.com", "adb")).toBe(
      "wiseeff-bridge://install-tools?server=https%3A%2F%2Fwiseeff.example.com&protocol=adb"
    );
  });

  it("polls health until required tools become available", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-25T00:00:00.000Z",
          toolsInstall: { status: "running", protocol: "adb", updatedAt: "2026-06-25T00:00:00.000Z" },
          tools: { adb: { available: false }, hdc: { available: true } }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-25T00:00:01.000Z",
          toolsInstall: { status: "succeeded", protocol: "adb", updatedAt: "2026-06-25T00:00:01.000Z" },
          tools: { adb: { available: true, source: "managed" }, hdc: { available: true } }
        })
      }) as typeof fetch;

    await expect(
      pollBridgeToolInstall({
        fetchImpl,
        protocol: "adb",
        intervalMs: 1,
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({
      tools: { adb: { available: true, source: "managed" } }
    });
  });

  it("tracks first-click confirm preference separately from connect", () => {
    const storage = new Map<string, string>();
    const shim = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    };
    expect(shouldConfirmBridgeToolInstall(shim)).toBe(true);
    rememberBridgeToolInstallConfirm(shim);
    expect(shouldConfirmBridgeToolInstall(shim)).toBe(false);
  });
});
