import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  gate0SecretValuesFromEnv,
  persistGate0ExactValuesForRescan,
  sanitizeGate0ArtifactTree,
  scanGate0ArtifactTree,
} from "./gate0-artifact-sanitizer";

describe("Gate0 artifact sanitizer", () => {
  it("preserves diagnostic files while redacting credentials in plain files and trace ZIP entries", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-sanitize-"));
    const reportPath = path.join(root, "report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        route: "/api/v1/me",
        request: { headers: { Authorization: "Bearer plain-report-token-value" } },
      }),
    );
    const zip = new JSZip();
    zip.file(
      "trace.network",
      '{"route":"/api/v1/organizations","headers":{"authorization":"Bearer zipped-trace-token-value"}}\n',
    );
    zip.file(
      "resources/response.json",
      '{"failure":"rename mismatch","database":"postgres://owner:database-password@127.0.0.1:5432/owned"}\n',
    );
    const tracePath = path.join(root, "trace.zip");
    writeFileSync(tracePath, await zip.generateAsync({ type: "nodebuffer" }));

    const report = await sanitizeGate0ArtifactTree(root);
    const scan = await scanGate0ArtifactTree(root);
    const sanitizedZip = await JSZip.loadAsync(readFileSync(tracePath));

    expect(report).toMatchObject({ filesChanged: 2, replacements: 3 });
    expect(scan).toEqual({ filesScanned: 4, archivesScanned: 1, violations: [] });
    expect(readFileSync(reportPath, "utf8")).toContain('"route":"/api/v1/me"');
    expect(readFileSync(reportPath, "utf8")).toContain("Bearer [REDACTED]");
    expect(await sanitizedZip.file("trace.network")!.async("string")).toContain(
      '"route":"/api/v1/organizations"',
    );
    expect(await sanitizedZip.file("trace.network")!.async("string")).toContain("Bearer [REDACTED]");
    expect(await sanitizedZip.file("resources/response.json")!.async("string")).toContain(
      '"failure":"rename mismatch"',
    );
    expect(await sanitizedZip.file("resources/response.json")!.async("string")).toContain(
      "[REDACTED_DATABASE_URL]",
    );
  });

  it("recursively sanitizes a registered exact secret inside nested ZIP entries", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-nested-zip-"));
    const exactSecret = "9".repeat(64);
    const inner = new JSZip();
    inner.file("credential.txt", `opaque=${exactSecret}\n`);
    const outer = new JSZip();
    outer.file("nested.zip", await inner.generateAsync({ type: "nodebuffer" }));
    const archivePath = path.join(root, "outer.zip");
    writeFileSync(archivePath, await outer.generateAsync({ type: "nodebuffer" }));

    await sanitizeGate0ArtifactTree(root, undefined, [exactSecret]);

    const sanitizedOuter = await JSZip.loadAsync(readFileSync(archivePath));
    const sanitizedInner = await JSZip.loadAsync(
      await sanitizedOuter.file("nested.zip")!.async("nodebuffer"),
    );
    const credential = await sanitizedInner.file("credential.txt")!.async("string");
    expect(credential).toBe("opaque=[REDACTED]\n");
    expect(credential).not.toContain(exactSecret);
    expect((await scanGate0ArtifactTree(root, undefined, [exactSecret])).violations).toEqual([]);
  });

  it("sniffs a renamed top-level ZIP and recursively sanitizes a nested archive", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-renamed-zip-"));
    const exactSecret = "8".repeat(64);
    const inner = new JSZip();
    inner.file("credential.txt", `opaque=${exactSecret}\n`);
    const outer = new JSZip();
    outer.file("payload.bin", await inner.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const archivePath = path.join(root, "trace.bin");
    writeFileSync(archivePath, await outer.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

    const before = await scanGate0ArtifactTree(root, undefined, [exactSecret]);
    expect(before.archivesScanned).toBe(2);
    expect(before.violations).toHaveLength(1);
    await sanitizeGate0ArtifactTree(root, undefined, [exactSecret]);
    expect((await scanGate0ArtifactTree(root, undefined, [exactSecret])).violations).toEqual([]);
  });

  it("fails closed on excessive nested ZIP depth before publication", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-zip-depth-"));
    let value = Buffer.from("safe\n", "utf8");
    for (let depth = 0; depth < 5; depth += 1) {
      const zip = new JSZip();
      zip.file(depth === 0 ? "leaf.txt" : "nested.zip", value);
      value = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    }
    writeFileSync(path.join(root, "outer.zip"), value);

    await expect(scanGate0ArtifactTree(root)).rejects.toThrow(/nesting-depth safety limit/i);
    await expect(sanitizeGate0ArtifactTree(root)).rejects.toThrow(/nesting-depth safety limit/i);
  });

  it("rejects ZIP metadata credentials, duplicates, preambles, encryption, and unsupported compression", async () => {
    const secret = "7".repeat(64);

    const commentRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-zip-comment-"));
    const commented = new JSZip();
    commented.file("safe.txt", "safe\n");
    commented.comment = secret;
    writeFileSync(path.join(commentRoot, "comment.zip"), await commented.generateAsync({ type: "nodebuffer" }));
    expect((await scanGate0ArtifactTree(commentRoot, undefined, [secret])).violations).toHaveLength(1);
    await expect(sanitizeGate0ArtifactTree(commentRoot, undefined, [secret])).rejects.toThrow(/immutable metadata/i);

    const base = new JSZip();
    base.file("a.txt", "first");
    base.file("b.txt", "second");
    const original = await base.generateAsync({ type: "nodebuffer" });
    for (const [suffix, mutated, pattern] of [
      ["duplicate", replaceAllAscii(original, "b.txt", "a.txt"), /duplicate entry names/i],
      ["preamble", Buffer.concat([Buffer.from("prefix"), original]), /preamble|malformed local|central-directory bounds/i],
      ["trailing", Buffer.concat([original, Buffer.from("trailing")]), /trailing envelope|end-of-central/i],
      ["encrypted", patchZipHeaderWord(original, 6, 8, 0x0001), /encrypted entry/i],
      ["compression", patchZipHeaderWord(original, 8, 10, 99), /unsupported compression/i],
      ["fake-directory", patchFirstCentralExternalAttributes(original, 0x10), /inconsistent directory metadata/i],
    ] as const) {
      const root = mkdtempSync(path.join(tmpdir(), `wiseeff-gate0-zip-${suffix}-`));
      writeFileSync(path.join(root, "unsafe.zip"), mutated);
      await expect(scanGate0ArtifactTree(root)).rejects.toThrow(pattern);
    }
    const renamedPreambleRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-zip-renamed-preamble-"));
    writeFileSync(path.join(renamedPreambleRoot, "unsafe.bin"), Buffer.concat([Buffer.from("prefix"), original]));
    await expect(scanGate0ArtifactTree(renamedPreambleRoot)).rejects.toThrow(/central-directory bounds|preamble/i);
  });

  it("rejects a high-expansion DEFLATE entry using declared limits before extraction", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-zip-ratio-"));
    const zip = new JSZip();
    zip.file("high-ratio.txt", "A".repeat(2 * 1024 * 1024));
    writeFileSync(
      path.join(root, "ratio.zip"),
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }),
    );
    await expect(scanGate0ArtifactTree(root)).rejects.toThrow(/expansion-ratio safety limit/i);
  });

  it("applies the ZIP entry budget across the entire artifact tree", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-zip-tree-budget-"));
    for (const [archiveName, prefix] of [["first.zip", "a"], ["second.zip", "b"]] as const) {
      const zip = new JSZip();
      for (let index = 0; index < 5_001; index += 1) {
        zip.file(`${prefix}-${index}/`, null, { dir: true, createFolders: false });
      }
      writeFileSync(path.join(root, archiveName), await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
    }

    await expect(scanGate0ArtifactTree(root)).rejects.toThrow(/entry-count safety limit/i);
  }, 15_000);

  it("reports only paths and categories when an archive still contains a credential", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-scan-"));
    const zip = new JSZip();
    zip.file("trace.trace", '{"authorization":"Bearer must-not-appear-in-error-output"}\n');
    writeFileSync(path.join(root, "trace.zip"), await zip.generateAsync({ type: "nodebuffer" }));

    const scan = await scanGate0ArtifactTree(root);
    const serialized = JSON.stringify(scan);

    expect(scan.violations).toEqual([
      { artifactId: expect.stringMatching(/^artifact-[a-f0-9]{16}$/u), categories: ["bearer"] },
    ]);
    expect(serialized).not.toContain("must-not-appear-in-error-output");
  });

  it("fails closed instead of corrupting a binary attachment containing a credential", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-binary-"));
    const attachment = path.join(root, "attachment.bin");
    const original = Buffer.concat([
      Buffer.from([0, 1, 2, 3]),
      Buffer.from("Bearer binary-secret-material"),
      Buffer.from([0, 255, 4]),
    ]);
    writeFileSync(attachment, original);

    await expect(sanitizeGate0ArtifactTree(root)).rejects.toThrow(/binary artifact.*bearer/i);
    expect(readFileSync(attachment)).toEqual(original);
  });

  it("fails closed without rewriting an ASCII credential in an unknown binary format", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-ascii-binary-"));
    const attachment = path.join(root, "diagnostic.bin");
    const original = Buffer.from("header=stable\nAuthorization: Bearer ascii-binary-secret\n", "ascii");
    writeFileSync(attachment, original);

    await expect(sanitizeGate0ArtifactTree(root)).rejects.toThrow(/unsupported artifact format.*bearer/i);
    expect(readFileSync(attachment)).toEqual(original);
  });

  it("sanitizes printable UTF-8 Markdown in an extensionless Playwright report resource", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-playwright-resource-"));
    const resource = path.join(
      root,
      "full-owned-run",
      "artifacts",
      "browser",
      "playwright-report",
      "resources",
      "a".repeat(40),
    );
    const secret = "b".repeat(64);
    mkdirSync(path.dirname(resource), { recursive: true });
    writeFileSync(resource, `# Browser failure\n\nAUTH_TOKEN_HMAC_SECRET: ${secret}\n`, "utf8");

    const report = await sanitizeGate0ArtifactTree(root);
    const content = readFileSync(resource, "utf8");

    expect(report).toMatchObject({ filesChanged: 1, replacements: 1 });
    expect(content).toContain("# Browser failure");
    expect(content).toContain("AUTH_TOKEN_HMAC_SECRET: [REDACTED]");
    expect(content).not.toContain(secret);
    expect((await scanGate0ArtifactTree(root)).violations).toEqual([]);
  });

  it("sanitizes printable Markdown in a Playwright report data archive resource", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-playwright-data-resource-"));
    const archivePath = path.join(
      root,
      "full-owned-run",
      "artifacts",
      "browser",
      "playwright-report",
      "data",
      `${"a".repeat(40)}.zip`,
    );
    const resourceName = `resources/${"c".repeat(40)}`;
    const secret = "b".repeat(64);
    const archive = new JSZip();
    archive.file(resourceName, `# Browser failure\n\nAUTH_TOKEN_HMAC_SECRET: ${secret}\n`);
    mkdirSync(path.dirname(archivePath), { recursive: true });
    writeFileSync(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await sanitizeGate0ArtifactTree(root);

    const sanitizedArchive = await JSZip.loadAsync(readFileSync(archivePath));
    const content = await sanitizedArchive.file(resourceName)!.async("string");
    expect(content).toContain("# Browser failure");
    expect(content).toContain("AUTH_TOKEN_HMAC_SECRET: [REDACTED]");
    expect(content).not.toContain(secret);
    expect((await scanGate0ArtifactTree(root)).violations).toEqual([]);
  });

  it("refuses extensionless Markdown resources outside a Playwright report archive", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-non-playwright-resource-"));
    const archivePath = path.join(root, "diagnostics.zip");
    const resourceName = `resources/${"c".repeat(40)}`;
    const secret = "b".repeat(64);
    const archive = new JSZip();
    archive.file(resourceName, `# Diagnostic\n\nAUTH_TOKEN_HMAC_SECRET: ${secret}\n`);
    writeFileSync(archivePath, await archive.generateAsync({ type: "nodebuffer" }));

    await expect(sanitizeGate0ArtifactTree(root)).rejects.toThrow(/unsupported artifact format/i);

    const retainedArchive = await JSZip.loadAsync(readFileSync(archivePath));
    expect(await retainedArchive.file(resourceName)!.async("string")).toContain(secret);
  });

  it("refuses a Playwright report resource containing a Unicode control character", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-playwright-control-resource-"));
    const resource = path.join(
      root,
      "full-owned-run",
      "artifacts",
      "browser",
      "playwright-report",
      "resources",
      "a".repeat(40),
    );
    const secret = "b".repeat(64);
    mkdirSync(path.dirname(resource), { recursive: true });
    writeFileSync(resource, `# Browser failure\n\n\u0080AUTH_TOKEN_HMAC_SECRET: ${secret}\n`, "utf8");

    await expect(sanitizeGate0ArtifactTree(root)).rejects.toThrow(/unsupported artifact format/i);
    expect(readFileSync(resource, "utf8")).toContain(secret);
  });

  it("refuses a Playwright report resource containing a Unicode format character", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-playwright-format-resource-"));
    const resource = path.join(
      root,
      "full-owned-run",
      "artifacts",
      "browser",
      "playwright-report",
      "resources",
      "a".repeat(40),
    );
    const secret = "b".repeat(64);
    mkdirSync(path.dirname(resource), { recursive: true });
    writeFileSync(resource, `# Browser failure\n\n\u202eAUTH_TOKEN_HMAC_SECRET: ${secret}\n`, "utf8");

    await expect(sanitizeGate0ArtifactTree(root)).rejects.toThrow(/unsupported artifact format/i);
    expect(readFileSync(resource, "utf8")).toContain(secret);
  });

  it("scans ordinary paths and ZIP entry names without returning the secret-bearing names", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-secret-path-"));
    const secretFileName = "Bearer ordinary-secret-name.json";
    const secretEntryName = "resources/Bearer zipped-secret-name.json";
    writeFileSync(path.join(root, secretFileName), '{"diagnostic":"safe"}\n');
    const zip = new JSZip();
    zip.file(secretEntryName, '{"diagnostic":"safe"}\n');
    writeFileSync(path.join(root, "trace.zip"), await zip.generateAsync({ type: "nodebuffer" }));

    const scan = await scanGate0ArtifactTree(root);
    const serialized = JSON.stringify(scan);

    expect(scan.violations).toHaveLength(2);
    expect(scan.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactId: expect.stringMatching(/^artifact-[a-f0-9]{16}$/u), categories: ["bearer"] }),
      ]),
    );
    expect(serialized).not.toContain("ordinary-secret-name");
    expect(serialized).not.toContain("zipped-secret-name");
  });

  it("removes legacy secret-derived descriptor verifiers without touching object marker hashes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-verifier-"));
    const descriptor = path.join(root, "runtime.json");
    writeFileSync(descriptor, JSON.stringify({
      auth: { secretSha256: "a".repeat(64) },
      database: { connectionSha256: "b".repeat(64) },
      objectStore: { markerSha256: "c".repeat(64) },
      processes: { api: { processIdentity: { commandSha256: "d".repeat(64) } } },
    }));

    await sanitizeGate0ArtifactTree(root);
    const raw = readFileSync(descriptor, "utf8");
    expect(raw).toContain('"secretSha256":"[REMOVED_SECRET_DERIVED_VERIFIER]"');
    expect(raw).toContain('"connectionSha256":"[REMOVED_SECRET_DERIVED_VERIFIER]"');
    expect(raw).toContain(`"markerSha256":"${"c".repeat(64)}"`);
    expect(raw).toContain(`"commandSha256":"${"d".repeat(64)}"`);
    expect((await scanGate0ArtifactTree(root)).violations).toEqual([]);
  });

  it("redacts canonical secret assignments and injected values across text and trace ZIP artifacts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-known-secrets-"));
    const injectedSecret = "injected-provider-secret-9f8e7d6c";
    const injectedSecretValues = gate0SecretValuesFromEnv({
      PATH: "/usr/bin",
      XIAOZE_LLM_API_KEY: injectedSecret,
    });
    expect(injectedSecretValues).toEqual([injectedSecret]);
    const reportPath = path.join(root, "provider.log");
    writeFileSync(
      reportPath,
      [
        "XIAOZE_LLM_API_KEY=plain-xiaoze-secret",
        'runtime={"LOG_ANALYSIS_API_KEY":"json-log-secret","EMBEDDING_API_KEY":"json-embedding-secret"}',
        `provider-response=${injectedSecret}`,
      ].join("\n"),
    );
    const zip = new JSZip();
    zip.file(
      "resources/environment.json",
      JSON.stringify({
        OBJECT_STORAGE_ACCESS_KEY_ID: "owned-access-key-id",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "owned-secret-access-key",
      }),
    );
    const tracePath = path.join(root, "trace.zip");
    writeFileSync(tracePath, await zip.generateAsync({ type: "nodebuffer" }));

    const before = await scanGate0ArtifactTree(root, undefined, injectedSecretValues);
    expect(before.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categories: ["canonical-secret", "injected-secret"] }),
        expect.objectContaining({ categories: ["canonical-secret"] }),
      ]),
    );
    expect(JSON.stringify(before)).not.toContain(injectedSecret);

    await sanitizeGate0ArtifactTree(root, undefined, injectedSecretValues);
    const sanitizedZip = await JSZip.loadAsync(readFileSync(tracePath));
    const serializedArtifacts = [
      readFileSync(reportPath, "utf8"),
      await sanitizedZip.file("resources/environment.json")!.async("string"),
    ].join("\n");
    expect(serializedArtifacts).not.toContain("plain-xiaoze-secret");
    expect(serializedArtifacts).not.toContain("json-log-secret");
    expect(serializedArtifacts).not.toContain("json-embedding-secret");
    expect(serializedArtifacts).not.toContain("owned-access-key-id");
    expect(serializedArtifacts).not.toContain("owned-secret-access-key");
    expect(serializedArtifacts).not.toContain(injectedSecret);
    expect(await scanGate0ArtifactTree(root, undefined, injectedSecretValues)).toMatchObject({ violations: [] });
  });

  it("redacts an otherwise unlabelled 64-hex generated secret only when the owner supplies its exact value", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-generated-secret-"));
    const generatedSecret = "d".repeat(64);
    const artifact = path.join(root, "nested-runtime.log");
    writeFileSync(artifact, `opaque-diagnostic=${generatedSecret}\n`);

    const withoutRegistry = await scanGate0ArtifactTree(root, undefined, []);
    expect(withoutRegistry.violations).toEqual([]);
    const withRegistry = await scanGate0ArtifactTree(root, undefined, [generatedSecret]);
    expect(withRegistry.violations).toEqual([
      expect.objectContaining({ categories: ["injected-secret"] }),
    ]);

    await sanitizeGate0ArtifactTree(root, undefined, [generatedSecret]);
    expect(readFileSync(artifact, "utf8")).toBe("opaque-diagnostic=[REDACTED]\n");
    expect((await scanGate0ArtifactTree(root, undefined, [generatedSecret])).violations).toEqual([]);
  });

  it("lets a fresh CI process detect a registered opaque nested secret after Gate0 sanitization fails", async () => {
    const uploadRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-rescan-registry-"));
    const root = path.join(uploadRoot, "full-owned-run");
    mkdirSync(root);
    const opaqueNestedSecret = "opaque-nested-runtime-value-7f4c8a21e5";
    writeFileSync(
      path.join(root, "unsupported.bin"),
      Buffer.from(`diagnostic=${opaqueNestedSecret}\n`, "ascii"),
    );

    await expect(sanitizeGate0ArtifactTree(root, undefined, [opaqueNestedSecret]))
      .rejects.toThrow(/unsupported artifact format.*injected-secret/i);
    const registryName = readdirSync(root).find((entry) => entry.endsWith(".enc.json"));
    expect(registryName).toBeDefined();
    const registryRaw = readFileSync(path.join(root, registryName!), "utf8");
    const registry = JSON.parse(registryRaw) as { keyFile: string };
    expect(registryRaw).not.toContain(opaqueNestedSecret);
    expect(path.dirname(registry.keyFile)).not.toBe(root);
    expect(readFileSync(registry.keyFile).includes(Buffer.from(opaqueNestedSecret))).toBe(false);

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts/gate0-artifact-sanitizer.ts"), "--root", uploadRoot],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(opaqueNestedSecret);
  });

  it("fails closed without deleting an unverified candidate-shaped forensic artifact", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-abandoned-candidate-"));
    const candidate = path.join(
      root,
      ".gate0-exact-values.v1.enc.json.01234567-89ab-cdef-0123-456789abcdef.tmp",
    );
    const opaqueCandidateText = "candidate-private-opaque-value";
    writeFileSync(candidate, `{"opaque":"${opaqueCandidateText}"`, { mode: 0o600 });
    chmodSync(candidate, 0o600);
    writeFileSync(path.join(root, "safe.log"), "safe diagnostic\n");

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", path.resolve("scripts/gate0-artifact-sanitizer.ts"), "--root", root],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(opaqueCandidateText);
    expect(existsSync(candidate)).toBe(true);
  });

  it("promotes a validated interrupted first-publish candidate and preserves its exact context", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-promote-candidate-"));
    const secret = "candidate-owned-opaque-secret";
    const registryPath = path.join(root, ".gate0-exact-values.v1.enc.json");
    persistGate0ExactValuesForRescan(root, [secret]);
    const record = JSON.parse(readFileSync(registryPath, "utf8")) as { keyFile: string };
    const keyId = path.basename(record.keyFile, ".key");
    const candidatePath = `${registryPath}.${keyId}.tmp`;
    renameSync(registryPath, candidatePath);
    writeFileSync(path.join(root, "api.log"), `${secret}\n`);

    await sanitizeGate0ArtifactTree(root, undefined, []);
    expect(readFileSync(path.join(root, "api.log"), "utf8")).toBe("[REDACTED]\n");
    expect(existsSync(candidatePath)).toBe(false);
    expect((await scanGate0ArtifactTree(root, undefined, [])).violations).toEqual([]);
    expect(existsSync(registryPath)).toBe(false);
  });

  it("reports a canonical secret-bearing path by opaque id without exposing the path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-known-secret-path-"));
    const secretPath = "XIAOZE_LLM_API_KEY=secret-in-path.json";
    writeFileSync(path.join(root, secretPath), '{"diagnostic":"safe"}\n');

    const scan = await scanGate0ArtifactTree(root);
    const serialized = JSON.stringify(scan);

    expect(scan.violations).toEqual([
      { artifactId: expect.stringMatching(/^artifact-[a-f0-9]{16}$/u), categories: ["canonical-secret"] },
    ]);
    expect(serialized).not.toContain("secret-in-path");
  });
});

function replaceAllAscii(value: Buffer, from: string, to: string) {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error("ZIP test mutation requires equal-width names.");
  const copy = Buffer.from(value);
  let offset = 0;
  while ((offset = copy.indexOf(from, offset, "ascii")) >= 0) {
    copy.write(to, offset, "ascii");
    offset += to.length;
  }
  return copy;
}

function patchZipHeaderWord(value: Buffer, localOffset: number, centralOffset: number, replacement: number) {
  const copy = Buffer.from(value);
  const local = copy.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const central = copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (local < 0 || central < 0) throw new Error("ZIP test fixture lacks expected headers.");
  copy.writeUInt16LE(replacement, local + localOffset);
  copy.writeUInt16LE(replacement, central + centralOffset);
  return copy;
}

function patchFirstCentralExternalAttributes(value: Buffer, replacement: number) {
  const copy = Buffer.from(value);
  const central = copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (central < 0) throw new Error("ZIP test fixture lacks a central header.");
  copy.writeUInt32LE(replacement, central + 38);
  return copy;
}
