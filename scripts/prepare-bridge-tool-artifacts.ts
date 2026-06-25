import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "0.1.0";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(rootDir, "ops/self-hosted/bridge-tool-artifacts", VERSION);

const ADB_DOWNLOADS: Record<string, string> = {
  darwin: "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip",
  windows: "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
};

async function download(url: string, destination: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await pipeline(response.body!, createWriteStream(destination));
}

async function zipSingleBinary(sourcePath: string, destinationZip: string, entryName: string) {
  await mkdir(path.dirname(destinationZip), { recursive: true });
  const tempDir = `${destinationZip}.staging`;
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  const stagedBinary = path.join(tempDir, entryName);
  await copyFile(sourcePath, stagedBinary);
  await chmod(stagedBinary, 0o755);
  const result = spawnSync("zip", ["-j", destinationZip, stagedBinary], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Failed to create ${destinationZip}`);
  }
  await rm(tempDir, { recursive: true, force: true });
}

async function prepareAdb(platform: "darwin" | "windows", arch: string) {
  const outDir = path.join(artifactRoot, platform, arch);
  const outZip = path.join(outDir, "adb-platform-tools.zip");
  const tempZip = path.join(outDir, ".download-adb.zip");
  console.log(`Preparing adb for ${platform}/${arch}...`);
  await download(ADB_DOWNLOADS[platform], tempZip);
  await copyFile(tempZip, outZip);
  await rm(tempZip, { force: true });
}

async function prepareHdc(platform: "darwin" | "windows", arch: string, sourcePath: string) {
  const outDir = path.join(artifactRoot, platform, arch);
  const outZip = path.join(outDir, "hdc.zip");
  const entryName = platform === "windows" ? "hdc.exe" : "hdc";
  console.log(`Preparing hdc for ${platform}/${arch} from ${sourcePath}...`);
  await zipSingleBinary(sourcePath, outZip, entryName);
}

async function main() {
  const hdcPath = process.env.HDC_SOURCE?.trim() || spawnSync("which", ["hdc"], { encoding: "utf8" }).stdout.trim();
  if (!hdcPath) {
    throw new Error("hdc not found on PATH; set HDC_SOURCE to a local hdc binary.");
  }

  await prepareAdb("darwin", "arm64");
  await prepareAdb("darwin", "amd64");
  await prepareAdb("windows", "amd64");

  await prepareHdc("darwin", "arm64", hdcPath);
  await prepareHdc("darwin", "amd64", hdcPath);

  const windowsHdc = process.env.HDC_WINDOWS_SOURCE?.trim();
  if (windowsHdc) {
    await prepareHdc("windows", "amd64", windowsHdc);
  } else {
    console.warn("Skipping windows/amd64/hdc.zip — set HDC_WINDOWS_SOURCE to a Windows hdc.exe to include it.");
    await writeFile(
      path.join(artifactRoot, "WINDOWS-HDC-PENDING.md"),
      "# Windows HDC artifact pending\n\nBuild on a Windows machine with hdc.exe available, then:\n\n```bash\nHDC_WINDOWS_SOURCE=/path/to/hdc.exe npm run bridge-tool-artifacts:prepare\nnpm run bridge-tool-artifacts:hash\n```\n"
    );
  }

  console.log("Tool artifact zips prepared under ops/self-hosted/bridge-tool-artifacts/");
}

void main();
