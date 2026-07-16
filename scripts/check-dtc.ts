import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type DtcProbeProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type DtcProbeResult = {
  available: boolean;
  version: string | null;
  error: string | null;
};

export function probeDtc(
  run: () => DtcProbeProcessResult = () => {
    const result = spawnSync("dtc", ["--version"], { encoding: "utf8" });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.error?.message ?? result.stderr ?? ""
    };
  }
): DtcProbeResult {
  const result = run();
  const version = result.stdout.trim() || result.stderr.trim();
  if (result.status === 0) {
    return { available: true, version: version || "dtc (version unavailable)", error: null };
  }
  return {
    available: false,
    version: null,
    error: version || "dtc executable was not found on PATH"
  };
}

async function main() {
  const required = process.argv.includes("--required");
  const result = probeDtc();
  console.log(JSON.stringify(result, null, 2));
  if (required && !result.available) {
    console.error(
      "dtc is required. Run `npm run dtc:bootstrap`, then retry.\n" +
        "For the full toolchain (dtc + fdtoverlay + dt-validate), use `npm run dts:toolchain:check`."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
