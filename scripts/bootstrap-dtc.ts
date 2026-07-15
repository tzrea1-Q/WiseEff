import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { probeDtc } from "./check-dtc";

export type DtcInstallCommand = {
  command: string;
  args: string[];
};

export function resolveDtcInstallCommand(input: {
  platform: NodeJS.Platform;
  osRelease: string;
  isRoot: boolean;
  hasSudo: boolean;
}): DtcInstallCommand {
  if (input.platform === "darwin") {
    return { command: "brew", args: ["install", "dtc"] };
  }
  if (input.platform !== "linux") {
    throw new Error("Automatic dtc installation is supported on macOS and Linux only.");
  }
  if (!input.isRoot && !input.hasSudo) {
    throw new Error("Linux dtc installation requires root or sudo access.");
  }

  const release = input.osRelease.toLowerCase();
  let command: DtcInstallCommand;
  if (release.includes("alpine")) {
    command = { command: "apk", args: ["add", "--no-cache", "dtc"] };
  } else if (release.includes("debian") || release.includes("ubuntu")) {
    command = {
      command: "sh",
      args: ["-lc", "apt-get update && apt-get install -y device-tree-compiler"]
    };
  } else if (
    release.includes("fedora") ||
    release.includes("rhel") ||
    release.includes("centos") ||
    release.includes("rocky") ||
    release.includes("almalinux")
  ) {
    command = { command: "dnf", args: ["install", "-y", "dtc"] };
  } else {
    throw new Error("Unsupported Linux distribution for automatic dtc installation.");
  }

  return input.isRoot
    ? command
    : command.command === "sh"
      ? { command: "sudo", args: ["sh", ...command.args] }
      : { command: "sudo", args: [command.command, ...command.args] };
}

function commandExists(command: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(command)) return false;
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

async function main() {
  const before = probeDtc();
  if (before.available) {
    console.log(`dtc is already available: ${before.version}`);
    return;
  }

  const osRelease = process.platform === "linux" ? readFileSync("/etc/os-release", "utf8") : "";
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const hasSudo = commandExists("sudo");
  const install = resolveDtcInstallCommand({
    platform: process.platform,
    osRelease,
    isRoot,
    hasSudo
  });

  if (!commandExists(install.command)) {
    throw new Error(`Required installer command is unavailable: ${install.command}`);
  }

  console.log(`Installing dtc with: ${install.command} ${install.args.join(" ")}`);
  const result = spawnSync(install.command, install.args, {
    stdio: "inherit",
    env:
      install.command === "brew"
        ? { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" }
        : process.env
  });
  if (result.status !== 0) {
    throw new Error(`dtc installation failed with exit code ${result.status ?? "unknown"}.`);
  }

  const after = probeDtc();
  if (!after.available) {
    throw new Error(`dtc installation completed but the compiler is still unavailable: ${after.error}`);
  }
  console.log(`dtc ready: ${after.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
