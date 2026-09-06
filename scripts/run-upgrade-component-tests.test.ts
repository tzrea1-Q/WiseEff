import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
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

it("kills a TERM-resistant descendant even after its leader closes", async () => {
  const descendant = "process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},5);";
  const leader = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']}); c.on('message',()=>process.stdout.write(String(c.pid))); setInterval(()=>{},5);`;
  const child = spawn(process.execPath, ["-e", leader], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: {} });
  const result = await superviseComponentProcess(child, { deadlineMs: 500, graceMs: 30, outputBytes: 1024 }).wait;
  const pid = Number(result.output);
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  let alive = true;
  for (let n = 0; n < 50; n++) {
    try { process.kill(pid, 0); await setTimeout(10); } catch { alive = false; break; }
  }
  // Only the exact child-created PID is eligible for emergency test cleanup.
  if (alive) process.kill(pid, "SIGKILL");
  expect(alive).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(child.signalCode).toBe("SIGTERM");
});

it.each([[], ["--suite", "bindings"], ["--expected-daemon-id", "owned", "--suite", "unknown"], ["--expected-daemon-id", "owned", "--suite", "bindings", "--database-url", "forbidden"]].map(args => ({ args })))("refuses incomplete or external component runner input %#", async ({ args }) => {
  expect(await runUpgradeComponentTests(args)).toMatchObject({ exitCode: 2 });
});
