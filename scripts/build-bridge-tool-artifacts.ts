import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const root = process.argv[2] ?? "ops/self-hosted/bridge-tool-artifacts";
  const versionDirs = await readdir(root);
  for (const version of versionDirs) {
    const manifestPath = path.join(root, version, "manifest.json");
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(manifestPath, "utf8");
    } catch {
      continue;
    }
    const manifest = JSON.parse(manifestRaw) as {
      recommendedVersion: string;
      minCompatibleVersion: string;
      items: Array<{
        platform: string;
        arch: string;
        protocol: string;
        version: string;
        artifact: string;
        sha256: string;
      }>;
    };

    for (const item of manifest.items) {
      const artifactPath = path.join(root, version, item.platform, item.arch, item.artifact);
      try {
        item.sha256 = await sha256File(artifactPath);
      } catch {
        console.warn(`Missing artifact: ${artifactPath}`);
      }
    }

    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Updated ${manifestPath}`);
  }
}

void main();
