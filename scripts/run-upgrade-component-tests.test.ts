import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { runUpgradeComponentTests, superviseComponentProcess } from "./run-upgrade-component-tests";

it.each(["toString", "__proto__", "constructor"])("rejects inherited suite name %s", async suite => {
  expect(await runUpgradeComponentTests(["--expected-daemon-id", "owned", "--suite", suite])).toMatchObject({ exitCode: 2 });
});

it.each(["deadline", "output"])("terminates a real child on %s without Docker", async kind => {
  const child = spawn(process.execPath, ["-e", `process.on('SIGTERM', () => {}); ${kind === "output" ? "setInterval(() => process.stdout.write('x'.repeat(2048)), 5);" : "setInterval(() => {}, 5);"}`], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: {} });
  const result = await superviseComponentProcess(child, { deadlineMs: 200, graceMs: 20, outputBytes: 1024 }).wait;
  expect(result.exitCode).toBe(1);
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1024);
  expect(child.signalCode).toBe("SIGKILL");
});

it.each([[], ["--suite", "bindings"], ["--expected-daemon-id", "owned", "--suite", "unknown"], ["--expected-daemon-id", "owned", "--suite", "bindings", "--database-url", "forbidden"]].map(args => ({ args })))("refuses incomplete or external component runner input %#", async ({ args }) => {
  expect(await runUpgradeComponentTests(args)).toMatchObject({ exitCode: 2 });
});
