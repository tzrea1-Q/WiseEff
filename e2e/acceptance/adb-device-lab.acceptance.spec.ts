import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";

type AdbDeviceState = "device" | "unauthorized" | "offline" | "unknown";

type AdbSmokeConfig = {
  projectId: string;
  deviceId: string;
  targetRef: string;
  parameterId: string;
  nodePath: string;
  readValuePattern?: RegExp;
  userId: string;
  writeEnabled: boolean;
  writeValue?: string;
  confirmWrite: string;
  confirmRollback: string;
};

function adbCommandAvailable() {
  const result = spawnSync("adb", ["version"], { encoding: "utf8", env: process.env });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
    error: result.error
  };
}

function parseAdbDevices(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => {
      const [serial, state = "unknown"] = line.split(/\s+/);
      return { serial, state: state as AdbDeviceState };
    })
    .filter((item) => Boolean(item.serial));
}

function requireSingleReadyAdbTarget(targetRef: string) {
  const available = adbCommandAvailable();
  if (!available.ok) {
    throw new Error(
      [
        "ADB device-lab acceptance requires adb on PATH.",
        available.stderr || available.stdout,
        available.error ? available.error.message : ""
      ].filter(Boolean).join("\n")
    );
  }

  const result = spawnSync("adb", ["devices"], { encoding: "utf8", env: process.env });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(`adb devices failed with exit code ${result.status ?? "unknown"}: ${stderr || stdout.trim()}`);
  }

  const matches = parseAdbDevices(stdout).filter((item) => item.serial === targetRef);
  if (matches.length !== 1) {
    throw new Error(
      `ADB target ${targetRef} must appear exactly once in adb devices. Observed: ${parseAdbDevices(stdout)
        .map((item) => `${item.serial}:${item.state}`)
        .join(", ") || "(none)"}`
    );
  }
  if (matches[0].state !== "device") {
    throw new Error(`ADB target ${targetRef} is ${matches[0].state}; expected device.`);
  }
}

function requireAdbSmokeConfig(): AdbSmokeConfig {
  const required = [
    "ADB_SMOKE_PROJECT_ID",
    "ADB_SMOKE_DEVICE_ID",
    "ADB_SMOKE_TARGET_REF",
    "ADB_SMOKE_PARAMETER_ID",
    "ADB_SMOKE_NODE_PATH"
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      [
        `ADB device-lab acceptance requires ${missing.join(", ")} when DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true.`,
        "Set project, WiseEff device id, adb serial, parameter id, and safe node path before running against real hardware."
      ].join(" ")
    );
  }

  const writeEnabled = process.env.ADB_SMOKE_ENABLE_WRITE === "true";
  if (writeEnabled && !process.env.ADB_SMOKE_WRITE_VALUE?.trim()) {
    throw new Error("ADB_SMOKE_WRITE_VALUE is required when ADB_SMOKE_ENABLE_WRITE=true.");
  }

  return {
    projectId: process.env.ADB_SMOKE_PROJECT_ID!.trim(),
    deviceId: process.env.ADB_SMOKE_DEVICE_ID!.trim(),
    targetRef: process.env.ADB_SMOKE_TARGET_REF!.trim(),
    parameterId: process.env.ADB_SMOKE_PARAMETER_ID!.trim(),
    nodePath: process.env.ADB_SMOKE_NODE_PATH!.trim(),
    readValuePattern: process.env.ADB_SMOKE_EXPECT_READ_PATTERN?.trim()
      ? new RegExp(process.env.ADB_SMOKE_EXPECT_READ_PATTERN.trim())
      : undefined,
    userId: process.env.ADB_SMOKE_USER_ID?.trim() || "u-xu-yun",
    writeEnabled,
    writeValue: process.env.ADB_SMOKE_WRITE_VALUE?.trim(),
    confirmWrite: process.env.ADB_SMOKE_CONFIRM_WRITE?.trim() || "confirm-high-risk-write",
    confirmRollback: process.env.ADB_SMOKE_CONFIRM_ROLLBACK?.trim() || "confirm-rollback"
  };
}

test.describe("ADB device-lab preflight", () => {
  test("validates local ADB device-lab configuration", async () => {
    // @acceptance ADB-LAB-001
    // @operation ADB-LAB-001
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE !== "adb",
      "ADB device-lab acceptance only runs when DEBUG_DEVICE_GATEWAY_MODE=adb."
    );
    test.skip(
      process.env.ADB_DEVICE_LAB_AVAILABLE !== "true",
      "ADB device-lab acceptance is skipped unless real hardware is available."
    );

    const config = requireAdbSmokeConfig();
    requireSingleReadyAdbTarget(config.targetRef);
    expect(config.writeEnabled ? config.writeValue : "read-only").toBeTruthy();
  });
});
