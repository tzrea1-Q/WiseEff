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

  it("retries a transient EPERM process-group probe until exact absence is observed", async () => {
    const permissionError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const signals: NodeJS.Signals[] = [];
    let probes = 0;

    await stopOwnedProcessGroup(12_345, {
      processGroupExists: async () => {
        probes += 1;
        if (probes === 1) throw permissionError;
        return false;
      },
      signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
      verifyGraceMs: 50,
      wait: async () => undefined,
    });

    expect(probes).toBe(2);
    expect(signals).toEqual([]);
  });

  it("propagates persistent EPERM probes instead of classifying the process group absent", async () => {
    const permissionError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const signals: NodeJS.Signals[] = [];

    await expect(stopOwnedProcessGroup(12_345, {
      processGroupExists: async () => { throw permissionError; },
      signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
      verifyGraceMs: 0,
      wait: async () => undefined,
    })).rejects.toThrow(/operation not permitted/i);

    expect(signals).toEqual([]);
  });

  it("continues through identity verification and signaling after a transient EPERM resolves present", async () => {
    const permissionError = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const expected = { startToken: "owned", commandSha256: "a".repeat(64) };
    const probes: Array<Error | boolean> = [permissionError, true, false];
    const signals: NodeJS.Signals[] = [];

    await stopOwnedProcessGroup(12_345, {
      expectedProcessIdentity: expected,
      readProcessIdentity: () => expected,
      processGroupExists: async () => {
        const result = probes.shift();
        if (result instanceof Error) throw result;
        return result ?? false;
      },
      signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
      terminateGraceMs: 50,
      verifyGraceMs: 50,
      wait: async () => undefined,
    });

    expect(probes).toEqual([]);
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("rechecks process-start identity before KILL and never signals a reused PID", async () => {
    const expected = { startToken: "original", commandSha256: "a".repeat(64) };
    const observed = [expected, { startToken: "reused", commandSha256: "b".repeat(64) }];
    const signals: NodeJS.Signals[] = [];

    await expect(stopOwnedProcessGroup(12_345, {
      expectedProcessIdentity: expected,
      readProcessIdentity: () => observed.shift(),
      signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
      processGroupExists: async () => true,
      terminateGraceMs: 0,
      verifyGraceMs: 0,
      wait: async () => undefined,
    })).rejects.toThrow(/process-start identity.*refusing signal/i);

    expect(signals).toEqual(["SIGTERM"]);
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
