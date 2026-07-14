import { spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ValidationMode = "block" | "warn" | "off";

export interface DtcDiagnostic {
  file: string;
  line?: number;
  severity: "error" | "warning";
  message: string;
}

export interface DtcValidationResult {
  ok: boolean;
  mode: ValidationMode;
  diagnostics: DtcDiagnostic[];
  compiler: "dtc" | "unavailable";
}

export interface DtcValidatorFile {
  name: string;
  content: string;
}

export interface DtcValidateOptions {
  mode?: ValidationMode;
  timeoutMs?: number;
  /** Reserved extension point for optional dt-schema binding validation. Defaults to off. */
  enableDtSchema?: boolean;
}

export interface DtcValidator {
  validate(files: DtcValidatorFile[], opts?: DtcValidateOptions): Promise<DtcValidationResult>;
}

const DEFAULT_MODE: ValidationMode = "block";
const DEFAULT_TIMEOUT_MS = 10_000;
const SKIPPED_FILE_LABEL = "<validation>";

export function readDtsValidationMode(env: NodeJS.ProcessEnv = process.env): ValidationMode {
  const raw = env.DTS_VALIDATION_MODE;
  if (raw === "block" || raw === "warn" || raw === "off") {
    return raw;
  }
  return DEFAULT_MODE;
}

export function createStubDtcValidator(
  handler: (
    files: DtcValidatorFile[],
    opts: DtcValidateOptions
  ) => DtcValidationResult | Promise<DtcValidationResult>
): DtcValidator {
  return {
    async validate(files, opts = {}) {
      return handler(files, opts);
    }
  };
}

/**
 * Loosely parses dtc stderr diagnostic lines. Handles both the plain
 * "file:line: severity: message" shape and real dtc's
 * "file:line.col-col: Severity (check-name): message" shape.
 */
const DIAGNOSTIC_LINE = /^(.+?):(\d+)(?:\.\d+(?:-\d+)?)?:\s*(fatal error|error|warning)\b[^:]*:\s*(.+)$/i;

function parseDtcStderr(stderr: string): DtcDiagnostic[] {
  const diagnostics: DtcDiagnostic[] = [];
  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = DIAGNOSTIC_LINE.exec(line);
    if (!match) continue;

    const [, file, lineNumber, severityRaw, message] = match;
    diagnostics.push({
      file: file.trim(),
      line: Number(lineNumber),
      severity: severityRaw.toLowerCase() === "warning" ? "warning" : "error",
      message: message.trim()
    });
  }
  return diagnostics;
}

function isOverlayFile(file: DtcValidatorFile): boolean {
  return file.name.endsWith(".dtso") || file.content.includes("/plugin/");
}

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }
  return env;
}

type SpawnFn = typeof nodeSpawn;

type ProcessResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
};

function runProcess(
  spawnFn: SpawnFn,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawnFn(command, args, { cwd: options.cwd, env: options.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (code: number | null, spawnError?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut, spawnError });
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => finish(null, err));
    child.on("close", (code) => finish(code));
  });
}

function createDefaultWhichDtc(spawnFn: SpawnFn): () => Promise<string | null> {
  return async () => {
    const result = await runProcess(spawnFn, "dtc", ["-v"], { cwd: tmpdir(), env: minimalEnv() }, 3_000);
    return result.spawnError ? null : "dtc";
  };
}

export interface CreateSubprocessDtcValidatorDeps {
  spawnFn?: SpawnFn;
  whichDtc?: () => Promise<string | null>;
  tmpDirFactory?: () => string;
}

/**
 * Restricted subprocess implementation of DtcValidator (locked decision D):
 * runs `dtc` in an isolated tmpdir with a minimal (PATH-only) env, a hard
 * timeout that kills the child, and best-effort tmpdir cleanup in `finally`.
 * mode=off never invokes whichDtc/spawn so it can never block on a slow or
 * hanging environment; degrade semantics for mode=block/warn are decided by
 * locked decision E once compiler availability is known.
 */
export function createSubprocessDtcValidator(deps: CreateSubprocessDtcValidatorDeps = {}): DtcValidator {
  const spawnFn = deps.spawnFn ?? nodeSpawn;
  const whichDtc = deps.whichDtc ?? createDefaultWhichDtc(spawnFn);
  const tmpDirFactory = deps.tmpDirFactory ?? (() => mkdtempSync(join(tmpdir(), "dtc-validate-")));

  return {
    async validate(files, opts = {}) {
      const mode = opts.mode ?? readDtsValidationMode(process.env);
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      if (mode === "off") {
        return {
          ok: true,
          mode,
          compiler: "unavailable",
          diagnostics: [
            { file: SKIPPED_FILE_LABEL, severity: "warning", message: "DTS validation skipped (mode=off)." }
          ]
        };
      }

      const dtcPath = await whichDtc();
      if (!dtcPath) {
        return {
          ok: mode !== "block",
          mode,
          compiler: "unavailable",
          diagnostics: [
            {
              file: SKIPPED_FILE_LABEL,
              severity: "warning",
              message: "dtc compiler is unavailable; validation was skipped and requires human confirmation."
            }
          ]
        };
      }

      const tmpDir = tmpDirFactory();
      const diagnostics: DtcDiagnostic[] = [];
      try {
        for (const file of files) {
          const filePath = join(tmpDir, file.name);
          writeFileSync(filePath, file.content, "utf8");

          const outPath = join(tmpDir, `${file.name}.dtb`);
          const args = ["-I", "dts", "-O", "dtb", "-o", outPath, ...(isOverlayFile(file) ? ["-@"] : []), filePath];

          const result = await runProcess(spawnFn, dtcPath, args, { cwd: tmpDir, env: minimalEnv() }, timeoutMs);

          if (result.timedOut) {
            diagnostics.push({ file: file.name, severity: "error", message: "dtc validation timed out." });
            continue;
          }
          if (result.spawnError) {
            diagnostics.push({
              file: file.name,
              severity: "error",
              message: `Failed to run dtc: ${result.spawnError.message}`
            });
            continue;
          }

          diagnostics.push(...parseDtcStderr(result.stderr));
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }

      const ok = mode === "warn" ? true : !diagnostics.some((diagnostic) => diagnostic.severity === "error");

      return { ok, mode, compiler: "dtc", diagnostics };
    }
  };
}
