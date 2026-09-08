import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";

// Real OS child/signals and TCP listener; explicit resource/admission seam.
// No Catalog admission or real database/Redis processing is claimed here.
it.each(["initializing", "active"])("settles resources after repeated signals during %s", async mode => {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createServer } from 'node:net';
    import { runProcessWithSignals } from './server/processSignals.ts';
    let release; const gate = new Promise(resolve => { release = resolve; });
    let databaseClosed = false, lateWrites = 0, stops = 0, listener;
    const send = value => process.send(value);
    process.on('message', message => { if (message === 'release') release(); });
    const active = gate.then(() => { if (databaseClosed) lateWrites++; });
    await runProcessWithSignals({ failureCode: 'PCAT-TEST-SHUTDOWN-FAILED',
      async initialize(signal) {
        if (${JSON.stringify(mode)} === 'initializing') { send('initializing'); await gate; }
        if (signal.aborted) return;
        listener = createServer(); await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
        send('active');
      },
      async shutdown() {
        stops++; send('draining'); await active;
        if (listener) await new Promise(resolve => listener.close(resolve));
        databaseClosed = true;
        send({ stops, lateWrites, databaseClosed, listenerClosed: !listener?.listening });
        process.disconnect();
      }
    });
  `], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const messages: unknown[] = [];
  let diagnostic = "";
  child.on("message", message => messages.push(message));
  child.stderr!.on("data", chunk => { diagnostic += chunk; });
  const exited = once(child, "exit");
  try {
    await expect.poll(() => messages.includes(mode)).toBe(true);
    child.kill("SIGTERM");
    // Wait for either observed draining or a bounded turn while init is held.
    await new Promise(resolve => setTimeout(resolve, 30));
    child.kill("SIGINT");
    expect(child.exitCode === null && child.signalCode === null).toBe(true);
    expect(messages.some(value => typeof value === "object")).toBe(false);
    child.send("release");
    const [code, signal] = await exited;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(messages.filter(value => value === "draining")).toHaveLength(1);
    expect(messages).toContainEqual({ stops: 1, lateWrites: 0, databaseClosed: true, listenerClosed: true });
    if (mode === "initializing") expect(messages).not.toContain("active");
    expect(diagnostic.length === 0).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
});
