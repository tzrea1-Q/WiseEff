import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { applyPlaywrightRuntimeLane } from "./playwright-runtime-lane";
import { createVitestImpact, type selectBrowserImpact } from "./test-impact";

type BrowserSelection = ReturnType<typeof selectBrowserImpact>;
export type BrowserWorktree = { root: string; gitDir: string; commonDir: string; branch: string; head: string; dirty: boolean };
const outcomeSchema = z.enum(["expected", "unexpected", "flaky", "skipped"]);
const testStatusSchema = z.enum(["passed", "failed", "timedOut", "skipped", "interrupted", "not-run"]);
const artifactSchema = z.object({ name: z.string(), contentType: z.string(), path: z.string(), inline: z.boolean() });
const attemptSchema = z.object({ status: testStatusSchema, retry: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), artifacts: z.array(artifactSchema) });
const testSchema = z.object({ file: z.string(), title: z.string(), project: z.string(), routes: z.array(z.string()), theme: z.enum(["light", "dark"]).nullable(), expectedStatus: testStatusSchema, outcome: outcomeSchema, durationMs: z.number().nonnegative(), attempts: z.array(attemptSchema) });
const runSchema = z.object({ suite: z.enum(["quality", "acceptance"]), status: z.enum(["passed", "failed"]), exitCode: z.number().int().nullable(), durationMs: z.number().nonnegative(), report: z.string(), error: z.string().nullable(), reportErrors: z.number().int().nonnegative(), tests: z.array(testSchema) });
const browserSelectionSchema = z.object({ fullFallback: z.boolean(), reasons: z.array(z.string()), qualityRoutes: z.array(z.string()).nonempty(), qualityGrep: z.string().min(1), acceptanceSpecs: z.array(z.string()).nonempty(), commands: z.array(z.string()) });
const passedRun = (run: z.infer<typeof runSchema>, acceptanceSpecs: readonly string[]) => run.exitCode === 0 && !run.error && run.reportErrors === 0
  && (run.suite !== "acceptance" || acceptanceSpecs.every((file) => run.tests.some((test) => test.file === file)))
  && run.tests.some((test) => test.project !== "runtime-warmup" && test.attempts.some((attempt) => !["skipped", "not-run"].includes(attempt.status)))
  && run.tests.every((test) => test.outcome === "skipped" || (test.outcome === "expected" && test.attempts.length > 0
    && test.attempts.at(-1)!.status === test.expectedStatus));

export const codexBrowserEvidenceSchema = z.object({
  version: z.literal(1), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), status: z.enum(["passed", "failed"]),
  worktree: z.object({ root: z.string(), branch: z.string(), head: z.string().regex(/^[a-f0-9]{40}$/), dirty: z.boolean() }),
  lane: z.object({ id: z.string(), baseURL: z.string().url(), apiURL: z.string().url(), databaseName: z.string(), objectStoreRoot: z.string(), outputDir: z.string(), reportDir: z.string() }),
  network: z.literal("macos-localhost-only"), selection: z.object({ changedPaths: z.array(z.string()).nonempty(), browser: browserSelectionSchema }),
  themes: z.array(z.enum(["light", "dark"])), runs: z.array(runSchema).length(2),
  spotCheck: z.object({ reviewer: z.string().min(1), checkedAt: z.string().datetime(), outcome: z.enum(["passed", "failed"]), notes: z.string().min(1) }).nullable(),
}).strict().superRefine((evidence, context) => {
  if (evidence.runs[0]?.suite !== "quality" || evidence.runs[1]?.suite !== "acceptance"
    || evidence.runs.some((run) => (run.status === "passed") !== passedRun(run, evidence.selection.browser.acceptanceSpecs))
    || (evidence.status === "passed") !== evidence.runs.every((run) => run.status === "passed")) {
    context.addIssue({ code: "custom", message: "Evidence status must match two nonempty, successful browser runs." });
  }
});

const reportTestSchema = z.object({ projectName: z.string(), expectedStatus: testStatusSchema, status: outcomeSchema, results: z.array(z.object({
  status: testStatusSchema.optional(), retry: z.number().int().nonnegative(), duration: z.number().nonnegative(),
  attachments: z.array(z.object({ name: z.string(), contentType: z.string(), path: z.string().optional(), body: z.string().optional() })),
})) });
const reportSpecSchema = z.object({ title: z.string(), file: z.string(), tests: z.array(reportTestSchema) });
type ReportSuite = { title: string; specs: z.infer<typeof reportSpecSchema>[]; suites?: ReportSuite[] };
const reportSuiteSchema: z.ZodType<ReportSuite> = z.lazy(() => z.object({ title: z.string(), specs: z.array(reportSpecSchema), suites: z.array(reportSuiteSchema).optional() }));
const reportSchema = z.object({ config: z.object({ rootDir: z.string() }), errors: z.array(z.unknown()), suites: z.array(reportSuiteSchema) });

function worktreePath(root: string, file: string) {
  const local = relative(root, resolve(root, file));
  if (!local || isAbsolute(local) || local === ".." || local.startsWith("../")) throw new Error("Artifact/file path must remain inside the worktree.");
  return local;
}

export function summarizeBrowserReport(plan: ReturnType<typeof planCodexBrowserRun>, suite: "quality" | "acceptance", input: unknown, exitCode: number | null, durationMs: number) {
  const reportPath = `${plan.lane.outputDir}/${suite}/results.json`;
  const run: z.infer<typeof runSchema> = { suite, status: "failed", exitCode, durationMs, report: reportPath, error: input === null ? "report-missing" : null, reportErrors: 0, tests: [] };
  if (input === null) return run;
  const report = reportSchema.parse(input);
  if (report.config.rootDir !== resolve(plan.worktree.root, "e2e", suite)) throw new Error("Unexpected browser report root.");
  run.reportErrors = report.errors.length;
  const visit = (suites: ReportSuite[], titles: string[]) => {
    for (const group of suites) {
      for (const spec of group.specs) {
        const file = worktreePath(plan.worktree.root, resolve(report.config.rootDir, spec.file));
        if (suite === "acceptance" && !plan.selection.acceptanceSpecs.includes(file) && file !== "e2e/acceptance/runtime-warmup.spec.ts") throw new Error("Report includes a spec outside the browser selection.");
        const title = [...titles, group.title, spec.title].join(" > ");
        const theme = title.match(/\((light|dark)\)/)?.[1] as "light" | "dark" | undefined;
        for (const test of spec.tests) run.tests.push({
          file, title, project: test.projectName, routes: [...new Set(spec.title.match(/\/[^\s()]+/g) ?? [])], theme: theme ?? null,
          expectedStatus: test.expectedStatus, outcome: test.status, durationMs: test.results.reduce((total, result) => total + result.duration, 0), attempts: test.results.map((result) => ({
            status: result.status ?? "not-run", retry: result.retry, durationMs: result.duration,
            artifacts: result.attachments.map((attachment) => ({ name: attachment.name, contentType: attachment.contentType,
              path: attachment.path ? worktreePath(plan.worktree.root, attachment.path) : reportPath, inline: !attachment.path })),
          })),
        });
      }
      visit(group.suites ?? [], [...titles, group.title]);
    }
  };
  visit(report.suites, []);
  run.status = passedRun(run, plan.selection.acceptanceSpecs) ? "passed" : "failed";
  return run;
}

export function buildCodexBrowserEvidence(plan: ReturnType<typeof planCodexBrowserRun>, changedPaths: string[], runs: z.infer<typeof runSchema>[], startedAt = new Date().toISOString()) {
  const { root, branch, head, dirty } = plan.worktree;
  return codexBrowserEvidenceSchema.parse({
    version: 1, startedAt, finishedAt: new Date().toISOString(), status: runs.every((run) => run.status === "passed") ? "passed" : "failed",
    worktree: { root, branch, head, dirty }, lane: plan.lane, network: "macos-localhost-only",
    selection: { changedPaths, browser: plan.selection },
    themes: [...new Set(runs.flatMap((run) => run.tests.filter((test) => test.outcome !== "skipped" && test.attempts.length)
      .flatMap((test) => test.theme ? [test.theme] : [])))].sort(), runs, spotCheck: null,
  });
}
const userTempDirectory = realpathSync(tmpdir());
const tsxIpcDirectory = JSON.stringify(resolve(userTempDirectory, `tsx-${process.geteuid?.() ?? userInfo().username}`));
const localhostProfile = `(version 1)
(allow default)
(deny network*)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
(allow network-bind (local unix-socket (subpath ${tsxIpcDirectory})))
(allow network-inbound (local unix-socket (subpath ${tsxIpcDirectory})))
(allow network-outbound (remote unix-socket (subpath ${tsxIpcDirectory})))`;

export function planCodexBrowserRun(worktree: BrowserWorktree, selection: BrowserSelection, environment: NodeJS.ProcessEnv, platform = process.platform) {
  if (platform !== "darwin") throw new Error("Localhost-only browser execution currently requires macOS sandbox-exec; no unrestricted fallback.");
  if (worktree.gitDir === worktree.commonDir || !relative(resolve(worktree.commonDir, "worktrees"), worktree.gitDir).match(/^[^./][^/]*$/)) {
    throw new Error("Run from a dedicated worktree, never the main checkout.");
  }
  if (!worktree.branch.startsWith("codex/")) throw new Error("A codex/<task> task branch is required.");
  if (!environment.WISEEFF_RUNTIME_LANE) throw new Error("An explicit WISEEFF_RUNTIME_LANE is required.");
  for (const name of ["WISEEFF_QUALITY_LANE", "WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", "WISEEFF_QUALITY_SNAPSHOT_ROOT"]) {
    if (environment[name]?.trim()) throw new Error(`Runtime override ${name} is not allowed.`);
  }
  if (environment.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true" || environment.WISEEFF_ACCEPTANCE_OWNED_RUNTIME === "true") {
    throw new Error("Runtime reuse/owned overrides are not allowed.");
  }
  if (environment.OBJECT_STORE_MODE && environment.OBJECT_STORE_MODE !== "local") throw new Error("Only a local object store is allowed.");
  const database = new URL(environment.DATABASE_URL ?? "");
  if (!["127.0.0.1", "[::1]", "localhost"].includes(database.hostname)) throw new Error("DATABASE_URL must use localhost.");
  if (database.search) throw new Error("DATABASE_URL query overrides are not allowed.");
  const databaseLane = decodeURIComponent(database.pathname).match(/_lane_(\d+)$/)?.[1];
  if (databaseLane && databaseLane !== environment.WISEEFF_RUNTIME_LANE) throw new Error("DATABASE_URL belongs to another lane.");
  const objectStoreRoot = environment.OBJECT_STORE_ROOT ?? ".wiseeff-object-store";
  if (isAbsolute(objectStoreRoot) || relative(worktree.root, resolve(worktree.root, objectStoreRoot)).startsWith("..")) {
    throw new Error("OBJECT_STORE_ROOT must stay relative to the task worktree.");
  }
  if (!selection.qualityGrep || !selection.qualityRoutes.length || !selection.acceptanceSpecs.length) throw new Error("Empty browser selection; no passing no-op.");
  const env: NodeJS.ProcessEnv = { ...environment, TMPDIR: userTempDirectory, HOST: "127.0.0.1", OBJECT_STORE_MODE: "local", WISEEFF_ACCEPTANCE_ENV_FILE: "/dev/null" };
  const lane = applyPlaywrightRuntimeLane(env)!;
  const command = (suite: "quality" | "acceptance", filters: string[]) => ({
    suite,
    command: "/usr/bin/sandbox-exec",
    args: ["-p", localhostProfile, process.execPath, resolve(worktree.root, "node_modules/playwright/cli.js"),
      "test", "--config", `playwright.${suite}.config.ts`, ...filters],
    report: `${lane.outputDir}/${suite}/results.json`,
  });
  return {
    worktree, selection, env, platform,
    lane: { id: lane.id, baseURL: lane.baseURL, apiURL: lane.apiURL, databaseName: decodeURIComponent(new URL(lane.databaseUrl).pathname.slice(1)), objectStoreRoot: lane.objectStoreRoot, outputDir: lane.outputDir, reportDir: lane.reportDir },
    commands: [command("quality", ["--grep", selection.qualityGrep!]), command("acceptance", selection.acceptanceSpecs.map((spec) => `${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))],
  };
}

type Launch = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit"; shell: false }) => { status: number | null; error?: Error; signal: NodeJS.Signals | null };

function assertLocalDestination(root: string, destination: string) {
  let existing = resolve(root, destination);
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = resolve(existing, "..");
  const actual = realpathSync(existing);
  if (actual !== root) worktreePath(root, actual);
}

export function runCodexBrowserPlan(plan: ReturnType<typeof planCodexBrowserRun>, changedPaths: string[], launch: Launch = spawnSync) {
  const root = realpathSync(plan.worktree.root);
  for (const destination of [plan.lane.outputDir, plan.lane.reportDir, plan.lane.objectStoreRoot,
    ...plan.commands.map((command) => command.report)]) assertLocalDestination(root, destination);
  mkdirSync(resolve(root, plan.lane.outputDir), { recursive: true });
  const lock = resolve(root, plan.lane.outputDir, ".codex-browser-lock");
  mkdirSync(lock);
  const startedAt = new Date().toISOString();
  const evidencePath = resolve(root, plan.lane.outputDir, "codex-browser-evidence.json");
  try {
    assertLocalDestination(root, evidencePath);
    rmSync(evidencePath, { force: true });
    const runs = plan.commands.map((command) => {
      const reportPath = resolve(root, command.report);
      rmSync(reportPath, { force: true });
      const start = Date.now();
      let result: ReturnType<Launch>;
      try { result = launch(command.command, command.args, { cwd: root, env: plan.env, stdio: "inherit", shell: false }); }
      catch { result = { status: null, error: new Error("launch-error"), signal: null }; }
      let run: z.infer<typeof runSchema>;
      try {
        run = summarizeBrowserReport(plan, command.suite, existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null, result.status, Date.now() - start);
      } catch {
        run = summarizeBrowserReport(plan, command.suite, null, result.status, Date.now() - start);
        run.error = "invalid-report";
      }
      if (result.error || result.signal) { run.status = "failed"; run.error = result.signal ? "interrupted" : "launch-error"; }
      return run;
    });
    const evidence = buildCodexBrowserEvidence(plan, changedPaths, runs, startedAt);
    const temporary = `${evidencePath}.tmp`;
    assertLocalDestination(root, temporary);
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, evidencePath);
    return evidence;
  } finally {
    rmdirSync(lock);
  }
}

async function cli() {
  const { values, positionals } = parseArgs({ options: { base: { type: "string" }, check: { type: "string" } }, allowPositionals: true });
  if (values.check) {
    if (values.base || positionals.length) throw new Error("--check cannot be combined with a browser run.");
    const evidence = codexBrowserEvidenceSchema.parse(JSON.parse(readFileSync(values.check, "utf8")));
    console.log(`Valid browser evidence: ${evidence.status}; spot-check: ${evidence.spotCheck?.outcome ?? "pending"}`);
    process.exitCode = evidence.status === "passed" && evidence.spotCheck?.outcome !== "failed" ? 0 : 1;
    return;
  }
  if ((values.base !== undefined) === (positionals.length > 0)) throw new Error("Usage: npm run test:browser:codex -- <changed files...> OR --base <commit> OR --check <evidence.json>");
  const root = realpathSync(process.cwd());
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (realpathSync(git(["rev-parse", "--show-toplevel"]).trim()) !== root) throw new Error("Run from the task worktree root.");
  const worktree = {
    root, gitDir: realpathSync(git(["rev-parse", "--absolute-git-dir"]).trim()),
    commonDir: realpathSync(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
    branch: git(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim(), head: git(["rev-parse", "HEAD"]).trim(),
    dirty: Boolean(git(["status", "--porcelain"]).trim()),
  };
  let paths = positionals;
  if (values.base !== undefined) {
    const base = git(["rev-parse", "--verify", "--end-of-options", `${values.base}^{commit}`]).trim();
    paths = [...git(["diff", "--name-only", "--no-renames", "-z", base, "--"]).split("\0"),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")].filter(Boolean);
  }
  const selection = await createVitestImpact(paths, root);
  const plan = planCodexBrowserRun(worktree, selection.browser, process.env);
  if (!existsSync("/usr/bin/sandbox-exec")) throw new Error("sandbox-exec is unavailable; refusing unrestricted execution.");
  const evidence = runCodexBrowserPlan(plan, selection.changedPaths);
  console.log(`${evidence.status}: ${plan.lane.outputDir}/codex-browser-evidence.json (coordinator spot-check pending)`);
  process.exitCode = evidence.status === "passed" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await cli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
