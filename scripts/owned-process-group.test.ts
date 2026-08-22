import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  stopOwnedProcessGroup,
  waitForOwnedProcessGroupExit,
} from "./owned-process-group";

describe("owned process-group supervisor", () => {
  it("waits for abort cleanup and leaves no process-group orphan", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const controller = new AbortController();
    const waiting = waitForOwnedProcessGroupExit(child, {
      signal: controller.signal,
      terminateGraceMs: 25,
      verifyGraceMs: 250,
    });
    controller.abort(new Error("owner timeout"));

    await expect(waiting).rejects.toThrow(/owner timeout/i);
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });

  it("propagates a non-ESRCH signal failure instead of reporting the group stopped", async () => {
    const permissionError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });

    await expect(stopOwnedProcessGroup(12345, {
      signalProcessGroup: async () => { throw permissionError; },
      processGroupExists: async () => true,
      wait: async () => undefined,
    })).rejects.toThrow(/operation not permitted/i);
  });

  it("settles an aborted public wait with both the timeout and failed-kill evidence", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const controller = new AbortController();
    const permissionError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const waiting = waitForOwnedProcessGroupExit(child, {
      signal: controller.signal,
      signalProcessGroup: async () => { throw permissionError; },
      processGroupExists: async () => true,
    });
    controller.abort(new Error("owner timeout"));

    const caught = await waiting.catch((error) => error as AggregateError);
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.message).toMatch(/owner timeout.*cleanup failed/i);
    expect(caught.errors.map((error) => (error as Error).message)).toEqual([
      "owner timeout",
      "operation not permitted",
    ]);

    await stopOwnedProcessGroup(child, { terminateGraceMs: 25, verifyGraceMs: 250 });
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });
});
