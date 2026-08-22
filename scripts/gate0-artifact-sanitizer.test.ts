import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
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
    }));

    await sanitizeGate0ArtifactTree(root);
    const raw = readFileSync(descriptor, "utf8");
    expect(raw).toContain('"secretSha256":"[REMOVED_SECRET_DERIVED_VERIFIER]"');
    expect(raw).toContain('"connectionSha256":"[REMOVED_SECRET_DERIVED_VERIFIER]"');
    expect(raw).toContain(`"markerSha256":"${"c".repeat(64)}"`);
    expect((await scanGate0ArtifactTree(root)).violations).toEqual([]);
  });
});
