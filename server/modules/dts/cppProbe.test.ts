import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeDtsPreprocessor } from "./cppSources";
import { requirePinnedDtsPreprocessor } from "../../../scripts/bootstrap-dts-toolchain";

describe("preprocessing sandbox probe diagnostics", () => {
  const originalPath = process.env.PATH;
  const directory = mkdtempSync(join(tmpdir(), "dts-probe-"));
  afterEach(() => { process.env.PATH = originalPath; rmSync(directory, { recursive: true, force: true }); });

  it("identifies the failed check without exposing Docker output", async () => {
    writeFileSync(join(directory, "docker"), '#!/bin/sh\nif [ "$1" = image ]; then echo linux/amd64; else echo secret >&2; exit 1; fi\n');
    chmodSync(join(directory, "docker"), 0o755);
    process.env.PATH = directory;
    const result = await probeDtsPreprocessor();
    expect(result).toMatchObject({ available: false, diagnostic: "docker-info:exit-nonzero" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("distinguishes a timed-out image inspection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dts-probe-timeout-"));
    try {
      writeFileSync(join(dir, "docker"), "#!/bin/sh\nwhile :; do :; done\n");
      chmodSync(join(dir, "docker"), 0o755);
      process.env.PATH = dir;
      expect(await probeDtsPreprocessor()).toMatchObject({ available: false, diagnostic: "image-inspect:timeout" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 8000);

  it("keeps the runtime deadline while allowing a slow, valid bootstrap probe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dts-probe-slow-"));
    try {
      writeFileSync(join(dir, "docker"), '#!/bin/sh\nif [ "$1" = image ]; then echo linux/amd64; else /bin/sleep 6; echo "true true true"; fi\n');
      chmodSync(join(dir, "docker"), 0o755);
      process.env.PATH = dir;
      expect(await probeDtsPreprocessor()).toMatchObject({ available: false, diagnostic: "docker-info:timeout" });
      await expect(requirePinnedDtsPreprocessor()).resolves.toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 22000);

  it("refuses bootstrap when a resource limit is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dts-probe-limits-"));
    try {
      writeFileSync(join(dir, "docker"), '#!/bin/sh\nif [ "$1" = image ]; then echo linux/amd64; else echo "true false true"; fi\n');
      chmodSync(join(dir, "docker"), 0o755);
      process.env.PATH = dir;
      await expect(requirePinnedDtsPreprocessor()).rejects.toThrow("docker-info:unexpected-result");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("bounds bootstrap when Docker info never finishes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dts-probe-hang-"));
    const marker = join(dir, "started");
    try {
      writeFileSync(join(dir, "docker"), `#!/bin/sh\nif [ "$1" = image ]; then echo linux/amd64; else /usr/bin/touch '${marker}'; exec /bin/sleep 120; fi\n`);
      chmodSync(join(dir, "docker"), 0o755);
      process.env.PATH = dir;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const result = requirePinnedDtsPreprocessor();
      const rejected = expect(result).rejects.toThrow("docker-info:timeout");
      const deadline = Date.now() + 3000;
      while (!existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
      expect(existsSync(marker)).toBe(true);
      let settled = false;
      void result.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });
});
