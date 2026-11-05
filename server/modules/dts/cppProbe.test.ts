import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeDtsPreprocessor } from "./cppSources";

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
});
