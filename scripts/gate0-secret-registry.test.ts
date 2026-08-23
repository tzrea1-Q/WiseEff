import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  registerGate0GeneratedSecrets,
  startGate0SecretRegistry,
} from "./gate0-secret-registry";

describe("Gate0 in-memory secret registry", () => {
  it("does not outlive an owner cancellation during startup", async () => {
    const owner = new AbortController();
    owner.abort(new Error("owner deadline elapsed"));

    await expect(startGate0SecretRegistry(owner.signal)).rejects.toThrow(/deadline elapsed/i);
  });

  it("collects root and nested generated values without writing them to a manifest", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-register-"));
    const registry = await startGate0SecretRegistry();
    const rootSecret = "a".repeat(64);
    const rootBearer = "Bearer root-owned-token-value";
    const nestedSecret = "b".repeat(64);
    const nestedBearer = "Bearer nested-owned-token-value";

    try {
      registry.add([rootSecret, rootBearer], runRoot);
      await registerGate0GeneratedSecrets([nestedSecret, nestedBearer], registry.env);

      expect(registry.values()).toEqual(
        expect.arrayContaining([rootSecret, rootBearer, nestedSecret, nestedBearer]),
      );
      expect(JSON.stringify(registry.env)).not.toContain(rootSecret);
      expect(JSON.stringify(registry.env)).not.toContain(nestedSecret);
    } finally {
      await registry.close();
    }
  });

  it("persists each exact registration before acknowledgement so a fresh CI process survives owner SIGKILL", async () => {
    const uploadRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-register-crash-"));
    const runRoot = path.join(uploadRoot, "full-owned-run");
    mkdirSync(runRoot);
    const opaqueSecret = "c".repeat(64);
    if (process.platform === "win32") return;
    const registryModule = path.resolve("scripts/gate0-secret-registry.ts");
    const crashOwner = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", `import { writeFileSync } from "node:fs"; import { startGate0SecretRegistry } from ${JSON.stringify(registryModule)}; const registry = await startGate0SecretRegistry(); registry.add([${JSON.stringify(opaqueSecret)}], ${JSON.stringify(runRoot)}); writeFileSync(${JSON.stringify(path.join(runRoot, "api.log"))}, ${JSON.stringify(`crashed-owner=${opaqueSecret}\n`)}); process.kill(process.pid, "SIGKILL");`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(crashOwner.signal).toBe("SIGKILL");

    const persistedRecordPath = path.join(runRoot, ".gate0-exact-values.v1.enc.json");
    const persistedRecord = readFileSync(persistedRecordPath, "utf8");
    const keyFile = (JSON.parse(persistedRecord) as { keyFile: string }).keyFile;
    expect(persistedRecord).not.toContain(opaqueSecret);
    expect(readFileSync(keyFile)).not.toContain(Buffer.from(opaqueSecret));
    expect(lstatSync(persistedRecordPath).mode & 0o077).toBe(0);
    expect(lstatSync(keyFile).mode & 0o077).toBe(0);
    expect(lstatSync(path.dirname(keyFile)).mode & 0o077).toBe(0);

    const freshScan = spawnSync(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts/gate0-artifact-sanitizer.ts"), "--root", uploadRoot],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(freshScan.status).toBe(0);
    expect(`${freshScan.stdout}${freshScan.stderr}`).not.toContain(opaqueSecret);
    expect(JSON.parse(freshScan.stdout) as { sanitization: { replacements: number }; violationCount: number })
      .toMatchObject({ sanitization: { replacements: 1 }, violationCount: 0 });
    expect(readFileSync(path.join(runRoot, "api.log"), "utf8")).toContain("[REDACTED]");
  });

  it("serializes concurrent nested registrations into the persisted union", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-register-concurrent-"));
    const registry = await startGate0SecretRegistry();
    const rootSecret = "root-secret-material";
    const nestedSecrets = Array.from({ length: 12 }, (_, index) => `${index}`.padStart(2, "0").repeat(32));
    try {
      registry.add([rootSecret], runRoot);
      await Promise.all(nestedSecrets.map((secret) => registerGate0GeneratedSecrets([secret], registry.env)));
      for (const [index, secret] of nestedSecrets.entries()) {
        writeFileSync(path.join(runRoot, `nested-${index}.log`), `${secret}\n`);
      }
    } finally {
      await registry.close();
    }

    const freshScan = spawnSync(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts/gate0-artifact-sanitizer.ts"), "--root", runRoot],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(freshScan.status).toBe(0);
    expect(`${freshScan.stdout}${freshScan.stderr}`).not.toContain(nestedSecrets[0]);
    expect(JSON.parse(freshScan.stdout) as { sanitization: { replacements: number }; violationCount: number })
      .toMatchObject({ sanitization: { replacements: nestedSecrets.length }, violationCount: 0 });
    for (const index of nestedSecrets.keys()) {
      expect(readFileSync(path.join(runRoot, `nested-${index}.log`), "utf8")).toBe("[REDACTED]\n");
    }
  });

  it("does not acknowledge or retain a nested value when encrypted persistence fails", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-register-failure-"));
    const movedRoot = `${runRoot}-moved`;
    const registry = await startGate0SecretRegistry();
    const rejectedSecret = "rejected-nested-secret-material";
    try {
      registry.add(["bound-root-secret-material"], runRoot);
      renameSync(runRoot, movedRoot);
      writeFileSync(runRoot, "foreign non-directory");

      await expect(registerGate0GeneratedSecrets([rejectedSecret], registry.env)).rejects.toThrow(/status (?:400|503)/i);
      expect(registry.values()).not.toContain(rejectedSecret);
    } finally {
      await registry.close();
    }
  });

  it("seals registrations before artifact finalization", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-register-sealed-"));
    const registry = await startGate0SecretRegistry();
    const lateSecret = "late-nested-secret-material";
    try {
      registry.add(["root-secret-before-seal"], runRoot);
      await registry.seal();

      expect(() => registry.add([lateSecret], runRoot)).toThrow(/sealed/i);
      await expect(registerGate0GeneratedSecrets([lateSecret], registry.env)).rejects.toThrow(/status 503/i);
      expect(registry.values()).not.toContain(lateSecret);
    } finally {
      await registry.close();
    }
  });
});
