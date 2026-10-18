import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseContract, verifyFile } = require("../images/minio/prepare.cjs") as {
  parseContract: (text: string) => Record<string, string>;
  verifyFile: (file: string, hash: string) => Promise<void>;
};
const release = "RELEASE.2024-12-18T13-15-44Z";
const contract = readFileSync("ops/self-hosted/images/minio-bundle.env", "utf8")
  .replace(/^WISEEFF_(MINIO|MC)_SHA256=.*$/gm, `WISEEFF_$1_SHA256=${"a".repeat(64)}`);

function runLibrary(command: string, args: string[] = []) {
  return spawnSync("bash", ["-c", `source ops/self-hosted/scripts/upgrade-lib.sh\n${command}`, "test", ...args], { encoding: "utf8" });
}

describe("MinIO release images", () => {
  it("parses the data-only pinned binary contract, including CRLF", () => {
    expect(parseContract(contract.replaceAll("\n", "\r\n")).WISEEFF_MINIO_RELEASE).toBe(release);
  });

  it.each([
    ["duplicate", `${contract}\nWISEEFF_MINIO_RELEASE=${release}`],
    ["unknown", `${contract}\nUNTRUSTED=$(touch /tmp/must-not-execute)`],
    ["missing", contract.replace(/^WISEEFF_MC_SHA256=.*$/m, "")],
    ["placeholder", contract.replace("a".repeat(64), "REPLACE_WITH_SHA256_FROM_RELEASE")],
    ["wrong URL", contract.replace("https://github.com/minio/minio/", "https://example.invalid/")],
    ["wrong release", contract.replaceAll(release, "RELEASE.2025-01-01T00-00-00Z")],
    ["malformed", `${contract}\ninvalid`],
  ])("refuses a %s contract", (_name, text) => {
    expect(() => parseContract(text)).toThrow();
  });

  it("checks the binary bytes and refuses a checksum mismatch", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-minio-binary-"));
    const file = join(directory, "minio");
    writeFileSync(file, "offline release binary");
    try {
      await expect(verifyFile(file, createHash("sha256").update("offline release binary").digest("hex"))).resolves.toBeUndefined();
      await expect(verifyFile(file, "0".repeat(64))).rejects.toThrow("checksum mismatch");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each(["same-release", "legacy-digest", "legacy-rebuilt", "different-current", "different-backup", "legacy-unavailable"])(
    "checks release identity before stopping or replacing recovery data: %s", (scenario) => {
      const directory = mkdtempSync(join(tmpdir(), "wiseeff-minio-release-"));
      mkdirSync(join(directory, "data/.minio.sys"), { recursive: true });
      writeFileSync(join(directory, "data/.minio.sys/format.json"), "{}");
      writeFileSync(join(directory, "format"), "minio-volume-v1\n");
      writeFileSync(join(directory, "image-id"), "sha256:official\n");
      if (!scenario.startsWith("legacy-")) {
        writeFileSync(join(directory, "server-release"), scenario === "different-backup" ? "RELEASE.2025-01-01T00-00-00Z" : release);
      }
      const currentImage = scenario === "legacy-digest" ? "sha256:official" : "sha256:rebuilt";
      try {
        const result = runLibrary(`
          wiseeff_upgrade_state_read() { printf '%s' "${directory}"; }
          wiseeff_upgrade_local_minio_container() { printf 'minio-container'; }
          wiseeff_upgrade_wait_object_store_ready() { printf 'ready\\n'; }
          wiseeff_upgrade_compose() { printf 'stop\\n'; }
          wiseeff_upgrade_docker() {
            case "$1" in
              inspect) case "$3" in *Running*) printf false;; *) printf '${currentImage}';; esac;;
              run)
                if [ "\${!#}" = --version ]; then
                  [ "$2 $3 $4 $5 $6 $7" = '--rm --pull never --network none --entrypoint' ] || return 99
                  ${scenario === "legacy-unavailable" ? '[ "$9" != sha256:official ] || return 1' : ":"}
                  printf 'minio version ${scenario === "different-current" ? "RELEASE.2025-01-01T00-00-00Z" : release} (commit-id=test)\\n'
                else printf 'copy\\n'; fi;;
              start) printf 'start\\n';;
              *) return 99;;
            esac
          }
          wiseeff_upgrade_restore_objects
        `);
        const accepted = ["same-release", "legacy-digest", "legacy-rebuilt"].includes(scenario);
        expect(result.status, result.stderr).toBe(accepted ? 0 : 40);
        expect(result.stdout).toBe(accepted ? "stop\ncopy\nstart\nready\n" : "");
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  );

  it.each(["official", "build", "wrong-release", "skip-build"])("prepares and verifies images without pulling: %s", (scenario) => {
    const result = runLibrary(`
      upgrade_compose_dir=ops/self-hosted
      wiseeff_upgrade_ensure_base_image() { printf 'base\\n'; }
      wiseeff_upgrade_compose() { printf 'build:%s\\n' "$2"; }
      wiseeff_upgrade_docker() {
        case "$1" in
          image) case "$3" in minio/*) ${scenario === "official" ? "return 0" : "return 1"};; *) return 1;; esac;;
          tag) printf 'tag\\n';;
          run)
            case "$8" in
              /usr/bin/minio) printf 'minio version ${scenario === "wrong-release" ? "RELEASE.2025-01-01T00-00-00Z" : release} (commit-id=test)\\n';;
              /usr/bin/mc) printf 'mc version RELEASE.2024-11-21T17-21-54Z (commit-id=test)\\n';;
              *) return 99;;
            esac;;
          *) return 99;;
        esac
      }
      wiseeff_upgrade_prepare_minio_images ${scenario === "skip-build" ? "true" : "false"}
    `);
    expect(result.status === 0, result.stderr).toBe(["official", "build"].includes(scenario));
    if (scenario === "official") expect(result.stdout).not.toContain("build:");
    if (scenario === "build") expect(result.stdout).toMatch(/base[\s\S]*build:minio[\s\S]*build:minio-init/);
    if (scenario === "skip-build") expect(result.stdout).not.toContain("build:");
  });
});
