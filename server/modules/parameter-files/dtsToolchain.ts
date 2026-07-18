import { createHash } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type DtsToolchainMode = "release" | "warn" | "off";

export type DtsToolchainToolProbe = {
  path: string | null;
  version: string | null;
};

export type DtsToolchainProbe = {
  dtc: DtsToolchainToolProbe;
  fdtoverlay: DtsToolchainToolProbe;
  dtschema: DtsToolchainToolProbe;
};

export type DtsToolchainVersions = {
  dtc: string | null;
  fdtoverlay: string | null;
  dtschema: string | null;
};

export type DtsToolchainFailureCode =
  | "toolchain-unavailable"
  | "version-mismatch"
  | "path-escape"
  | "overlay-order"
  | "compile-failed"
  | "schema-failed"
  | "timeout";

export type DtsToolchainDiagnostic = {
  file: string;
  line?: number;
  severity: "error" | "warning";
  code?: DtsToolchainFailureCode | string;
  message: string;
  stage?: "dtc" | "fdtoverlay" | "dt-validate" | "path" | "toolchain";
};

export type DtsToolchainArtifacts = {
  baseDtbSha256?: string;
  effectiveDtbSha256?: string;
  inputManifestSha256?: string;
};

export type DtsToolchainResult = {
  ok: boolean;
  mode: DtsToolchainMode;
  compiler: DtsToolchainVersions;
  diagnostics: DtsToolchainDiagnostic[];
  artifacts: DtsToolchainArtifacts;
  failureCode?: DtsToolchainFailureCode;
};

export type DtsToolchainFile = {
  content: string;
};

export type DtsToolchainConfigSet = {
  entryFile: string;
  includeSearchPaths?: string[];
  overlayOrder: string[];
  files: ReadonlyMap<string, DtsToolchainFile>;
};

export type DtsToolchainValidateOptions = {
  mode?: DtsToolchainMode;
  timeoutMs?: number;
  /**
   * When false, `dt-validate` still runs and diagnostics are recorded, but schema
   * findings do not fail the run. Release defaults to true (fail-closed).
   */
  failOnSchema?: boolean;
};

export type PinnedDtsToolchainVersions = {
  dtc: { version: string; commit: string };
  dtschema: string;
};

type SpawnFn = typeof nodeSpawn;

type ProcessResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
};

export type CreateDtsToolchainRunnerDeps = {
  spawnFn?: SpawnFn;
  probeTools?: () => Promise<DtsToolchainProbe>;
  tmpDirFactory?: () => string;
  pinnedVersions?: PinnedDtsToolchainVersions;
};

export interface DtsToolchainRunner {
  validate(configSet: DtsToolchainConfigSet, opts?: DtsToolchainValidateOptions): Promise<DtsToolchainResult>;
  probe(): Promise<DtsToolchainProbe>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SKIPPED_FILE_LABEL = "<toolchain>";

const DIAGNOSTIC_LINE =
  /^(.+?):(\d+)(?:\.\d+(?:-\d+)?)?:\s*(fatal error|error|warning)\b[^:]*:\s*(.+)$/i;

function repoRootFromModule(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export type DtsToolchainCommands = {
  dtc: string;
  fdtoverlay: string;
  dtschema: string;
};

export type ResolveDtsToolchainCommandsOptions = {
  rootDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

function projectToolchainBinDir(rootDir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  const configuredDir = env.WISEEFF_DTS_TOOLCHAIN_DIR?.trim();
  const toolchainDir = configuredDir || join(rootDir, ".wiseeff-tools", "dts-toolchain");
  return join(toolchainDir, platform === "win32" ? "Scripts" : "bin");
}

function projectCommandCandidate(binDir: string, command: string, platform: NodeJS.Platform): string {
  return join(binDir, platform === "win32" ? `${command}.exe` : command);
}

/**
 * Resolve every DTS binary through one deterministic policy shared by API and CLI checks.
 * Explicit overrides are returned verbatim so a typo fails closed instead of silently
 * falling back. Otherwise the ignored repository-local venv/toolchain wins over PATH.
 */
export function resolveDtsToolchainCommands(
  options: ResolveDtsToolchainCommandsOptions = {}
): DtsToolchainCommands {
  const rootDir = options.rootDir ?? repoRootFromModule();
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const localBin = projectToolchainBinDir(rootDir, platform, env);
  const managedDirConfigured = Boolean(env.WISEEFF_DTS_TOOLCHAIN_DIR?.trim());
  const resolveCommand = (input: {
    overrideKey: "WISEEFF_DTC_PATH" | "WISEEFF_FDTOVERLAY_PATH" | "WISEEFF_DT_VALIDATE_PATH";
    command: string;
  }) => {
    const override = env[input.overrideKey]?.trim();
    if (override) return override;
    const local = projectCommandCandidate(localBin, input.command, platform);
    return managedDirConfigured || existsSync(local) ? local : input.command;
  };

  return {
    dtc: resolveCommand({ overrideKey: "WISEEFF_DTC_PATH", command: "dtc" }),
    fdtoverlay: resolveCommand({ overrideKey: "WISEEFF_FDTOVERLAY_PATH", command: "fdtoverlay" }),
    dtschema: resolveCommand({ overrideKey: "WISEEFF_DT_VALIDATE_PATH", command: "dt-validate" })
  };
}

/** Committed Linux dt-schema bindings generated from WiseEff vendor/golden compatibles. */
export function resolveLinuxBindingsDir(rootDir: string = repoRootFromModule()): string | null {
  const fromEnv = process.env.WISEEFF_DT_SCHEMA_BINDINGS_DIR?.trim();
  if (fromEnv) {
    return existsSync(fromEnv) ? fromEnv : null;
  }
  const committed = join(rootDir, "schemas/dts/linux-bindings");
  return existsSync(committed) ? committed : null;
}

export function loadPinnedToolchainVersions(
  rootDir: string = repoRootFromModule()
): PinnedDtsToolchainVersions {
  const raw = readFileSync(join(rootDir, "tools/dts-toolchain/versions.json"), "utf8");
  const parsed = JSON.parse(raw) as PinnedDtsToolchainVersions;
  return {
    dtc: {
      version: parsed.dtc.version,
      commit: parsed.dtc.commit
    },
    dtschema: parsed.dtschema
  };
}

function minimalEnv(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (sourceEnv.PATH) {
    env.PATH = sourceEnv.PATH;
  }
  return env;
}

function runProcess(
  spawnFn: SpawnFn,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawnFn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
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
      resolvePromise({ stdout, stderr, code, timedOut, spawnError });
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

/**
 * Extract a semver-like `X.Y` / `X.Y.Z` token from toolchain `--version` output.
 * Returns null when the output is empty or unparseable (fail-closed for release pins).
 */
export function extractSemverLike(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] ?? null;
}

function parseVersionToken(raw: string): string | null {
  return extractSemverLike(raw);
}

export type PinnedVersionCheckResult =
  | { ok: true }
  | { ok: false; tool: "dtc" | "fdtoverlay" | "dtschema"; actual: string | null; expected: string; reason: string };

/**
 * Compare probed toolchain versions against `tools/dts-toolchain/versions.json`.
 * `fdtoverlay` shares the pinned dtc version (same device-tree-compiler build).
 * Unparseable or mismatched versions fail closed.
 */
export function checkPinnedToolchainVersions(
  actual: DtsToolchainVersions,
  pinned: PinnedDtsToolchainVersions = loadPinnedToolchainVersions()
): PinnedVersionCheckResult {
  const checks: Array<{ tool: "dtc" | "fdtoverlay" | "dtschema"; actual: string | null; expected: string }> = [
    { tool: "dtc", actual: actual.dtc, expected: pinned.dtc.version },
    { tool: "fdtoverlay", actual: actual.fdtoverlay, expected: pinned.dtc.version },
    { tool: "dtschema", actual: actual.dtschema, expected: pinned.dtschema }
  ];

  for (const check of checks) {
    const parsed = extractSemverLike(check.actual);
    if (!parsed) {
      return {
        ok: false,
        tool: check.tool,
        actual: check.actual,
        expected: check.expected,
        reason: `Unparseable ${check.tool} version (expected ${check.expected}).`
      };
    }
    if (parsed !== check.expected) {
      return {
        ok: false,
        tool: check.tool,
        actual: parsed,
        expected: check.expected,
        reason: `${check.tool} version ${parsed} does not match pinned ${check.expected}.`
      };
    }
  }
  return { ok: true };
}

async function probeCommand(
  spawnFn: SpawnFn,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 3_000
): Promise<DtsToolchainToolProbe> {
  const result = await runProcess(spawnFn, command, args, { cwd: tmpdir(), env: minimalEnv(env) }, timeoutMs);
  if (result.spawnError || result.timedOut || result.code !== 0) {
    return { path: null, version: null };
  }
  return {
    path: command,
    version: parseVersionToken(result.stdout || result.stderr)
  };
}

export async function probeDtsToolchain(
  spawnFn: SpawnFn = nodeSpawn,
  options: ResolveDtsToolchainCommandsOptions = {}
): Promise<DtsToolchainProbe> {
  const env = options.env ?? process.env;
  const commands = resolveDtsToolchainCommands({ ...options, env });
  const [dtc, fdtoverlay, dtschema] = await Promise.all([
    probeCommand(spawnFn, commands.dtc, ["--version"], env),
    probeCommand(spawnFn, commands.fdtoverlay, ["--version"], env),
    probeCommand(spawnFn, commands.dtschema, ["--version"], env)
  ]);
  return { dtc, fdtoverlay, dtschema };
}

function versionsFromProbe(probe: DtsToolchainProbe): DtsToolchainVersions {
  return {
    dtc: probe.dtc.version,
    fdtoverlay: probe.fdtoverlay.version,
    dtschema: probe.dtschema.version
  };
}

function failed(
  mode: DtsToolchainMode,
  failureCode: DtsToolchainFailureCode,
  versions: DtsToolchainVersions,
  diagnostics: DtsToolchainDiagnostic[],
  artifacts: DtsToolchainArtifacts = {}
): DtsToolchainResult {
  return {
    ok: false,
    mode,
    compiler: versions,
    diagnostics,
    artifacts,
    failureCode
  };
}

function softUnavailable(
  mode: DtsToolchainMode,
  versions: DtsToolchainVersions,
  diagnostics: DtsToolchainDiagnostic[]
): DtsToolchainResult {
  return {
    ok: true,
    mode,
    compiler: versions,
    diagnostics,
    artifacts: {},
    failureCode: "toolchain-unavailable"
  };
}

function isSafeLogicalPath(logicalPath: string): boolean {
  if (!logicalPath || logicalPath.includes("\0")) return false;
  if (logicalPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(logicalPath)) return false;
  const normalized = normalize(logicalPath).replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) return false;
  if (normalized.split("/").some((part) => part === "..")) return false;
  return true;
}

function assertWithinRoot(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = resolve(rootDir);
  const resolvedCandidate = resolve(candidatePath);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("../"));
}

function parseDtcStderr(stderr: string): DtsToolchainDiagnostic[] {
  const diagnostics: DtsToolchainDiagnostic[] = [];
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
      message: message.trim(),
      stage: "dtc"
    });
  }
  return diagnostics;
}

function parseSchemaStderr(stderr: string, fileLabel: string): DtsToolchainDiagnostic[] {
  const diagnostics: DtsToolchainDiagnostic[] = [];
  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    diagnostics.push({
      file: fileLabel,
      severity: "error",
      message: line,
      stage: "dt-validate",
      code: "schema-failed"
    });
  }
  if (diagnostics.length === 0 && stderr.trim()) {
    diagnostics.push({
      file: fileLabel,
      severity: "error",
      message: stderr.trim(),
      stage: "dt-validate",
      code: "schema-failed"
    });
  }
  return diagnostics;
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inputManifestHash(configSet: DtsToolchainConfigSet): string {
  const entries = [...configSet.files.entries()]
    .map(([name, file]) => `${name}\0${sha256Hex(file.content)}`)
    .sort();
  return sha256Hex(
    JSON.stringify({
      entryFile: configSet.entryFile,
      overlayOrder: configSet.overlayOrder,
      includeSearchPaths: configSet.includeSearchPaths ?? [],
      files: entries
    })
  );
}

function writeLogicalTree(rootDir: string, configSet: DtsToolchainConfigSet): DtsToolchainDiagnostic[] {
  const diagnostics: DtsToolchainDiagnostic[] = [];
  for (const [logicalPath, file] of configSet.files) {
    if (!isSafeLogicalPath(logicalPath)) {
      diagnostics.push({
        file: logicalPath,
        severity: "error",
        code: "path-escape",
        stage: "path",
        message: `Logical path escapes the isolated toolchain workspace: ${logicalPath}`
      });
      continue;
    }
    const abs = join(rootDir, logicalPath);
    if (!assertWithinRoot(rootDir, abs)) {
      diagnostics.push({
        file: logicalPath,
        severity: "error",
        code: "path-escape",
        stage: "path",
        message: `Resolved path escapes the isolated toolchain workspace: ${logicalPath}`
      });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, "utf8");
  }
  return diagnostics;
}

/**
 * Complete DTS config-set toolchain runner:
 * base `dtc -@` → overlay DTBO → `fdtoverlay` in manifest order → `dt-validate`.
 * Restricted subprocess: isolated tmpdir, PATH-only env, hard timeout, no network assumptions.
 */
export function createDtsToolchainRunner(deps: CreateDtsToolchainRunnerDeps = {}): DtsToolchainRunner {
  const spawnFn = deps.spawnFn ?? nodeSpawn;
  const probeTools = deps.probeTools ?? (() => probeDtsToolchain(spawnFn));
  const tmpDirFactory = deps.tmpDirFactory ?? (() => mkdtempSync(join(tmpdir(), "dts-toolchain-")));
  const pinned = deps.pinnedVersions ?? loadPinnedToolchainVersions();

  const runner: DtsToolchainRunner = {
    async probe() {
      return probeTools();
    },

    async validate(configSet, opts = {}) {
      const mode = opts.mode ?? "release";
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const failOnSchema = opts.failOnSchema ?? mode === "release";
      const artifacts: DtsToolchainArtifacts = {
        inputManifestSha256: inputManifestHash(configSet)
      };

      if (mode === "off") {
        return {
          ok: true,
          mode,
          compiler: { dtc: null, fdtoverlay: null, dtschema: null },
          diagnostics: [
            {
              file: SKIPPED_FILE_LABEL,
              severity: "warning",
              message: "DTS toolchain validation skipped (mode=off)."
            }
          ],
          artifacts
        };
      }

      const probe = await probeTools();
      const versions = versionsFromProbe(probe);
      const toolsReady = Boolean(probe.dtc.path && probe.fdtoverlay.path && probe.dtschema.path);

      if (!toolsReady) {
        const diagnostics: DtsToolchainDiagnostic[] = [
          {
            file: SKIPPED_FILE_LABEL,
            severity: mode === "release" ? "error" : "warning",
            code: "toolchain-unavailable",
            stage: "toolchain",
            message:
              "DTS toolchain incomplete (need dtc, fdtoverlay, and dt-validate). " +
              `Pinned: dtc ${pinned.dtc.version} @ ${pinned.dtc.commit}, dtschema ${pinned.dtschema}.`
          }
        ];
        if (mode === "release") {
          return failed(mode, "toolchain-unavailable", versions, diagnostics, artifacts);
        }
        return softUnavailable(mode, versions, diagnostics);
      }

      const pinCheck = checkPinnedToolchainVersions(versions, pinned);
      if (!pinCheck.ok) {
        const diagnostics: DtsToolchainDiagnostic[] = [
          {
            file: SKIPPED_FILE_LABEL,
            severity: mode === "release" ? "error" : "warning",
            code: "version-mismatch",
            stage: "toolchain",
            message:
              `${pinCheck.reason} ` +
              `Pinned: dtc ${pinned.dtc.version} @ ${pinned.dtc.commit}, dtschema ${pinned.dtschema}.`
          }
        ];
        if (mode === "release") {
          return failed(mode, "version-mismatch", versions, diagnostics, artifacts);
        }
        return {
          ok: true,
          mode,
          compiler: versions,
          diagnostics,
          artifacts,
          failureCode: "version-mismatch"
        };
      }

      for (const name of [configSet.entryFile, ...configSet.overlayOrder]) {
        if (!isSafeLogicalPath(name)) {
          return failed(
            mode,
            "path-escape",
            versions,
            [
              {
                file: name,
                severity: "error",
                code: "path-escape",
                stage: "path",
                message: `Logical path escapes the isolated toolchain workspace: ${name}`
              }
            ],
            artifacts
          );
        }
      }

      for (const overlay of configSet.overlayOrder) {
        if (!configSet.files.has(overlay)) {
          return failed(
            mode,
            "overlay-order",
            versions,
            [
              {
                file: overlay,
                severity: "error",
                code: "overlay-order",
                stage: "path",
                message: `Overlay listed in overlayOrder is missing from the config-set manifest: ${overlay}`
              }
            ],
            artifacts
          );
        }
      }

      if (!configSet.files.has(configSet.entryFile)) {
        return failed(
          mode,
          "overlay-order",
          versions,
          [
            {
              file: configSet.entryFile,
              severity: "error",
              code: "overlay-order",
              stage: "path",
              message: `Entry file is missing from the config-set manifest: ${configSet.entryFile}`
            }
          ],
          artifacts
        );
      }

      const tmpDir = tmpDirFactory();
      const diagnostics: DtsToolchainDiagnostic[] = [];

      try {
        const pathDiagnostics = writeLogicalTree(tmpDir, configSet);
        if (pathDiagnostics.length > 0) {
          const result = failed(mode, "path-escape", versions, pathDiagnostics, artifacts);
          return mode === "warn" ? { ...result, ok: true } : result;
        }

        const baseSrc = join(tmpDir, configSet.entryFile);
        const baseDtb = join(tmpDir, "base.dtb");
        const baseCompile = await runProcess(
          spawnFn,
          probe.dtc.path!,
          ["-I", "dts", "-O", "dtb", "-o", baseDtb, "-@", baseSrc],
          { cwd: tmpDir, env: minimalEnv() },
          timeoutMs
        );

        if (baseCompile.timedOut) {
          diagnostics.push({
            file: configSet.entryFile,
            severity: "error",
            code: "timeout",
            stage: "dtc",
            message: "dtc validation timed out."
          });
          const result = failed(mode, "timeout", versions, diagnostics, artifacts);
          return mode === "warn" ? { ...result, ok: true } : result;
        }
        if (baseCompile.spawnError || (baseCompile.code !== 0 && baseCompile.code !== null)) {
          diagnostics.push(...parseDtcStderr(baseCompile.stderr));
          if (diagnostics.length === 0) {
            diagnostics.push({
              file: configSet.entryFile,
              severity: "error",
              code: "compile-failed",
              stage: "dtc",
              message:
                baseCompile.spawnError?.message ??
                (baseCompile.stderr.trim() || "dtc failed to compile base.")
            });
          }
          const result = failed(mode, "compile-failed", versions, diagnostics, artifacts);
          return mode === "warn" ? { ...result, ok: true } : result;
        }
        diagnostics.push(...parseDtcStderr(baseCompile.stderr));
        // vite-env stubs require encoding; latin1 preserves DTB bytes for hashing/copy.
        artifacts.baseDtbSha256 = createHash("sha256")
          .update(readFileSync(baseDtb, "latin1"), "latin1")
          .digest("hex");

        const dtboPaths: string[] = [];
        for (const overlayName of configSet.overlayOrder) {
          const overlaySrc = join(tmpDir, overlayName);
          const dtboPath = join(tmpDir, `${overlayName.replace(/[\\/]/g, "__")}.dtbo`);
          const overlayCompile = await runProcess(
            spawnFn,
            probe.dtc.path!,
            ["-I", "dts", "-O", "dtb", "-o", dtboPath, "-@", overlaySrc],
            { cwd: tmpDir, env: minimalEnv() },
            timeoutMs
          );

          if (overlayCompile.timedOut) {
            diagnostics.push({
              file: overlayName,
              severity: "error",
              code: "timeout",
              stage: "dtc",
              message: "dtc overlay compile timed out."
            });
            const result = failed(mode, "timeout", versions, diagnostics, artifacts);
            return mode === "warn" ? { ...result, ok: true } : result;
          }
          if (overlayCompile.spawnError || (overlayCompile.code !== 0 && overlayCompile.code !== null)) {
            diagnostics.push(...parseDtcStderr(overlayCompile.stderr));
            if (!diagnostics.some((d) => d.file === overlayName && d.severity === "error")) {
              diagnostics.push({
                file: overlayName,
                severity: "error",
                code: "compile-failed",
                stage: "dtc",
                message:
                  overlayCompile.spawnError?.message ??
                  (overlayCompile.stderr.trim() || "dtc failed to compile overlay.")
              });
            }
            const result = failed(mode, "compile-failed", versions, diagnostics, artifacts);
            return mode === "warn" ? { ...result, ok: true } : result;
          }
          diagnostics.push(...parseDtcStderr(overlayCompile.stderr));
          dtboPaths.push(dtboPath);
        }

        const effectiveDtb = join(tmpDir, "effective.dtb");
        if (dtboPaths.length === 0) {
          writeFileSync(effectiveDtb, readFileSync(baseDtb, "latin1"), "latin1");
        } else {
          const overlayApply = await runProcess(
            spawnFn,
            probe.fdtoverlay.path!,
            ["-i", baseDtb, "-o", effectiveDtb, ...dtboPaths],
            { cwd: tmpDir, env: minimalEnv() },
            timeoutMs
          );

          if (overlayApply.timedOut) {
            diagnostics.push({
              file: SKIPPED_FILE_LABEL,
              severity: "error",
              code: "timeout",
              stage: "fdtoverlay",
              message: "fdtoverlay timed out."
            });
            const result = failed(mode, "timeout", versions, diagnostics, artifacts);
            return mode === "warn" ? { ...result, ok: true } : result;
          }
          if (overlayApply.spawnError || (overlayApply.code !== 0 && overlayApply.code !== null)) {
            diagnostics.push({
              file: SKIPPED_FILE_LABEL,
              severity: "error",
              code: "compile-failed",
              stage: "fdtoverlay",
              message:
                overlayApply.spawnError?.message ??
                (overlayApply.stderr.trim() || "fdtoverlay failed to apply overlays.")
            });
            const result = failed(mode, "compile-failed", versions, diagnostics, artifacts);
            return mode === "warn" ? { ...result, ok: true } : result;
          }
        }

        artifacts.effectiveDtbSha256 = createHash("sha256")
          .update(readFileSync(effectiveDtb, "latin1"), "latin1")
          .digest("hex");

        // Prefer committed WiseEff Linux bindings with compatible-match so
        // proprietary golden properties are covered by vendor schema instead of
        // falling through bare dt-core — fail-closed schema errors still apply.
        const schemaDir = resolveLinuxBindingsDir();
        const schemaArgs = schemaDir
          ? ["-s", schemaDir, "-c", effectiveDtb]
          : [effectiveDtb];
        const schema = await runProcess(
          spawnFn,
          probe.dtschema.path!,
          schemaArgs,
          { cwd: tmpDir, env: minimalEnv() },
          timeoutMs
        );

        if (schema.timedOut) {
          diagnostics.push({
            file: "effective.dtb",
            severity: "error",
            code: "timeout",
            stage: "dt-validate",
            message: "dt-validate timed out."
          });
          const result = failed(mode, "timeout", versions, diagnostics, artifacts);
          return mode === "warn" ? { ...result, ok: true } : result;
        }
        if (schema.spawnError) {
          diagnostics.push({
            file: "effective.dtb",
            severity: "error",
            code: "toolchain-unavailable",
            stage: "dt-validate",
            message: schema.spawnError.message
          });
          const result = failed(mode, "toolchain-unavailable", versions, diagnostics, artifacts);
          return mode === "warn" ? { ...result, ok: true } : result;
        }

        const schemaOutput = `${schema.stderr}\n${schema.stdout}`.trim();
        const schemaReported =
          (schema.code !== 0 && schema.code !== null) || Boolean(schema.stderr.trim());
        if (schemaReported) {
          diagnostics.push(...parseSchemaStderr(schemaOutput || schema.stderr, "effective.dtb"));
        }

        if (mode === "warn") {
          return { ok: true, mode, compiler: versions, diagnostics, artifacts };
        }

        const hasCompileError = diagnostics.some(
          (d) => d.severity === "error" && d.stage !== "dt-validate"
        );
        if (hasCompileError) {
          return failed(mode, "compile-failed", versions, diagnostics, artifacts);
        }

        const hasSchemaError = diagnostics.some(
          (d) => d.severity === "error" && d.stage === "dt-validate"
        );
        if (hasSchemaError && failOnSchema) {
          return failed(mode, "schema-failed", versions, diagnostics, artifacts);
        }

        return {
          ok: true,
          mode,
          compiler: versions,
          diagnostics,
          artifacts
        };
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  };

  const innerValidate = runner.validate.bind(runner);
  runner.validate = async (configSet, opts = {}) => {
    const startedAt = Date.now();
    const mode = opts.mode ?? "release";
    try {
      const result = await innerValidate(configSet, opts);
      const durationMs = Math.max(0, Date.now() - startedAt);
      const { defaultMetricsRegistry } = await import("../../observability/metrics");
      defaultMetricsRegistry.recordDtsPipelineResult({
        stage: "compile",
        status: result.ok ? "succeeded" : "failed",
        durationMs
      });
      if (result.diagnostics.some((d) => d.stage === "dt-validate" || d.code === "schema-failed")) {
        defaultMetricsRegistry.recordDtsPipelineResult({
          stage: "schema",
          status: result.failureCode === "schema-failed" ? "failed" : result.ok ? "succeeded" : "failed",
          durationMs
        });
      }
      defaultMetricsRegistry.recordConfigPublishResult({
        result: mode === "off" ? "bypassed" : result.ok ? "passed" : "failed"
      });
      return result;
    } catch (error) {
      const { defaultMetricsRegistry } = await import("../../observability/metrics");
      defaultMetricsRegistry.recordDtsPipelineResult({
        stage: "compile",
        status: "failed",
        durationMs: Math.max(0, Date.now() - startedAt)
      });
      throw error;
    }
  };

  return runner;
}

export function isReleaseToolchainMode(mode: DtsToolchainMode | string): boolean {
  return mode === "release" || mode === "block";
}

/** Map legacy validation modes onto toolchain modes. `block` ≡ production `release`. */
export function toToolchainMode(mode: string | undefined): DtsToolchainMode {
  if (mode === "warn" || mode === "off" || mode === "release") {
    return mode;
  }
  return "release";
}
