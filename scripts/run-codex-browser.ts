import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parse } from "dotenv";
import { createServer } from "node:net";
import { request } from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import { applyPlaywrightRuntimeLane } from "./playwright-runtime-lane";
import { createVitestImpact, type selectBrowserImpact } from "./test-impact";
import { readStaticChanges, staticCoverageSchema, type StaticCoverage } from "./check-static-coverage";
import { buildPlaywrightWebServers, resolveApiAuthorization } from "../playwright.shared";
import { stopOwnedProcessGroup, waitForOwnedProcessGroupExit } from "./owned-process-group";
import { createBearerTokenForUser } from "../e2e/acceptance/helpers/runtime";
import { ACCEPTANCE_ORGANIZATION, castByRole } from "../e2e/acceptance/helpers/cast";
import { developmentAuthContext } from "../server/modules/auth/routes";

type BrowserSelection = ReturnType<typeof selectBrowserImpact>;
export type BrowserWorktree = { root: string; gitDir: string; commonDir: string; branch: string; head: string; dirty: boolean };
const outcomeSchema = z.enum(["expected", "unexpected", "flaky", "skipped"]);
const testStatusSchema = z.enum(["passed", "failed", "timedOut", "skipped", "interrupted", "not-run"]);
const artifactSchema = z.object({ name: z.string(), contentType: z.string(), path: z.string(), inline: z.boolean() });
const attemptSchema = z.object({ status: testStatusSchema, retry: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), artifacts: z.array(artifactSchema) });
const testSchema = z.object({ file: z.string(), title: z.string(), project: z.string(), routes: z.array(z.string()), theme: z.enum(["light", "dark"]).nullable(), expectedStatus: testStatusSchema, outcome: outcomeSchema, durationMs: z.number().nonnegative(), attempts: z.array(attemptSchema) });
const runSchema = z.object({ suite: z.enum(["quality", "acceptance"]), status: z.enum(["passed", "failed", "skipped"]), exitCode: z.number().int().nullable(), durationMs: z.number().nonnegative(), report: z.string(), error: z.string().nullable(), reportErrors: z.number().int().nonnegative(), tests: z.array(testSchema) });
const browserSelectionSchema = z.object({ fullFallback: z.boolean(), reasons: z.array(z.string()), qualityRoutes: z.array(z.string()).nonempty(), qualityGrep: z.string().min(1), acceptanceSpecs: z.array(z.string()), commands: z.array(z.string()) });
const authNames = ["AUTH_TOKEN_ISSUER", "AUTH_TOKEN_HMAC_SECRET"] as const;
const platformReason = "platform: Linux-only baselines";
const skipSchema = z.object({ suite: z.enum(["quality", "acceptance"]), project: z.string().nullable(), file: z.string().nullable(), status: z.literal("skipped"), reason: z.literal(platformReason) });
const blockSchema = z.object({ reason: z.enum(["static checks failed", "lane ports in use", "lane port check failed", "authentication probe failed", "runtime startup failed", "runtime teardown failed", "runtime interrupted"]), suite: z.enum(["quality", "acceptance"]).nullable(), ports: z.array(z.number().int().positive()).optional(), httpStatus: z.number().int().nullable().optional() });
type BrowserBlock = z.infer<typeof blockSchema>;
const authProbeSchema = z.object({ suite: z.enum(["quality", "acceptance"]), mode: z.enum(["development", "production"]), mechanism: z.enum(["development-header", "bearer"]), httpStatus: z.number().int().nullable() }).strict();
const spotCheckSchema = z.object({ reviewer: z.string().trim().min(1), checkedAt: z.string().datetime(), outcome: z.enum(["passed", "failed"]), notes: z.string().trim().min(1) }).strict();
type AuthProbe = z.infer<typeof authProbeSchema>;
const missingAuth = (env: NodeJS.ProcessEnv, selection: BrowserSelection) => selection.acceptanceSpecs.length ? authNames.filter((name) => !env[name]?.trim()) : [];
const successfulRuns = (runs: z.infer<typeof runSchema>[]) => runs.length === 2 && runs.some((run) => run.status === "passed") && runs.every((run) => run.status !== "failed");
const passedRun = (run: z.infer<typeof runSchema>, acceptanceSpecs: readonly string[]) => run.exitCode === 0 && !run.error && run.reportErrors === 0
  && (run.suite !== "acceptance" || acceptanceSpecs.every((file) => run.tests.some((test) => test.file === file)))
  && run.tests.some((test) => test.project !== "runtime-warmup" && test.attempts.some((attempt) => !["skipped", "not-run"].includes(attempt.status)))
  && run.tests.every((test) => test.outcome === "skipped" || (test.outcome === "expected" && test.attempts.length > 0
    && test.attempts.at(-1)!.status === test.expectedStatus));
const feedbackSchema = z.object({ base: z.string().regex(/^[a-f0-9]{40}$/).nullable().default(null), staticCoverage: staticCoverageSchema.nullable().default(null) }).strict();
const completedStatic = (coverage: StaticCoverage | null) => coverage?.status === "passed" || coverage?.status === "not-applicable";

export const codexBrowserEvidenceSchema = z.object({
  version: z.literal(1), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), status: z.union([z.enum(["passed", "failed"]), z.string().regex(/^blocked: (?:missing AUTH_TOKEN_(?:ISSUER|HMAC_SECRET)(?:, AUTH_TOKEN_HMAC_SECRET)?|static checks failed|lane ports in use|lane port check failed|authentication probe failed|runtime startup failed|runtime teardown failed|runtime interrupted)$/)]),
  worktree: z.object({ root: z.string(), branch: z.string(), head: z.string().regex(/^[a-f0-9]{40}$/), dirty: z.boolean() }),
  lane: z.object({ id: z.string(), baseURL: z.string().url(), apiURL: z.string().url(), databaseName: z.string(), objectStoreRoot: z.string(), outputDir: z.string(), reportDir: z.string() }),
  evidenceScope: z.literal("local-browser").default("local-browser"), ciStatus: z.literal("not-run").default("not-run"),
  network: z.literal("macos-localhost-only"), selection: feedbackSchema.extend({ changedPaths: z.array(z.string()).nonempty(), browser: browserSelectionSchema }),
  themes: z.array(z.enum(["light", "dark"])), runs: z.array(runSchema),
  missingConfig: z.array(z.enum(authNames)).default([]), skipped: z.array(skipSchema).default([]),
  block: blockSchema.nullable().default(null),
  authProbes: z.array(authProbeSchema).max(2).default([]),
  spotCheck: spotCheckSchema.nullable(),
}).strict().superRefine((evidence, context) => {
  const coverage = evidence.selection.staticCoverage;
  if (coverage && (coverage.files.map((file) => file.path).sort().join("\0") !== [...evidence.selection.changedPaths].sort().join("\0")
    || (coverage.status === "failed" && (evidence.runs.length > 0 || (!evidence.missingConfig.length && evidence.block?.reason !== "static checks failed"))))
    || (evidence.block?.reason === "static checks failed" && coverage?.status !== "failed")) {
    context.addIssue({ code: "custom", message: "Static feedback must describe the same changes and block runtime launch on failure." });
  }
  if (evidence.missingConfig.length) {
    if (evidence.status !== `blocked: missing ${evidence.missingConfig.join(", ")}` || evidence.runs.length || evidence.themes.length || evidence.block) {
      context.addIssue({ code: "custom", message: "Missing configuration must block before browser runs." });
    }
    return;
  }
  if (evidence.block) {
    if (evidence.status !== `blocked: ${evidence.block.reason}` || evidence.runs.length > 2
      || evidence.runs.some((run, index) => run.suite !== (index === 0 ? "quality" : "acceptance") || (run.status === "passed") !== passedRun(run, evidence.selection.browser.acceptanceSpecs))) {
      context.addIssue({ code: "custom", message: "Blocked evidence must match the preflight/teardown failure and completed runs." });
    }
    return;
  }
  if (evidence.status.startsWith("blocked:") || evidence.runs.length !== 2 || evidence.runs[0]?.suite !== "quality" || evidence.runs[1]?.suite !== "acceptance"
    || evidence.runs.some((run) => (run.status === "passed") !== passedRun(run, evidence.selection.browser.acceptanceSpecs))
    || evidence.runs.some((run) => run.status === "skipped" && (run.suite !== "acceptance" || evidence.selection.browser.acceptanceSpecs.length || run.exitCode !== null || run.tests.length || run.error !== platformReason || !evidence.skipped.some((skip) => skip.suite === "acceptance")))
    || (evidence.status === "passed") !== successfulRuns(evidence.runs)) {
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

export function buildCodexBrowserEvidence(plan: ReturnType<typeof planCodexBrowserRun>, changedPaths: string[], runs: z.infer<typeof runSchema>[], startedAt = new Date().toISOString(), block: BrowserBlock | null = null, authProbes: AuthProbe[] = []) {
  const { root, branch, head, dirty } = plan.worktree;
  const missingConfig = missingAuth(plan.env, plan.selection);
  return codexBrowserEvidenceSchema.parse({
    version: 1, startedAt, finishedAt: new Date().toISOString(), status: missingConfig.length ? `blocked: missing ${missingConfig.join(", ")}` : block ? `blocked: ${block.reason}` : successfulRuns(runs) ? "passed" : "failed",
    evidenceScope: "local-browser", ciStatus: "not-run",
    worktree: { root, branch, head, dirty }, lane: plan.lane, network: "macos-localhost-only",
    selection: { changedPaths, browser: plan.selection, ...plan.feedback }, missingConfig, skipped: plan.skipped, block, authProbes,
    themes: [...new Set(runs.flatMap((run) => run.tests.filter((test) => test.outcome !== "skipped" && test.attempts.length)
      .flatMap((test) => test.theme ? [test.theme] : [])))].sort(), runs, spotCheck: null,
  });
}
const userTempDirectory = realpathSync(tmpdir());
const tsxIpcDirectory = JSON.stringify(resolve(userTempDirectory, `tsx-${process.geteuid?.() ?? userInfo().username}`));
const localhostProfile = `(version 1)
(allow default)
(deny network*)
(allow system-socket (socket-domain AF_UNIX))
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
(allow network-bind (local unix-socket (subpath ${tsxIpcDirectory})))
(allow network-inbound (local unix-socket (subpath ${tsxIpcDirectory})))
(allow network-outbound (remote unix-socket (subpath ${tsxIpcDirectory})))`;

export function browserPlatformSkips(root: string, platform = process.platform): z.infer<typeof skipSchema>[] {
  if (platform === "linux") return [];
  const skipped: z.infer<typeof skipSchema>[] = [{ suite: "quality", project: "visual", file: null, status: "skipped", reason: platformReason }];
  for (const suite of ["quality", "acceptance"] as const) {
    const directory = resolve(root, "e2e", suite);
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory, { recursive: true })) {
      if (typeof file === "string" && file.endsWith(".spec.ts") && /\.(?:toHaveScreenshot|toMatchSnapshot)\s*\(/.test(readFileSync(resolve(directory, file), "utf8"))) {
        skipped.push({ suite, project: null, file: `e2e/${suite}/${file.replaceAll("\\", "/")}`, status: "skipped", reason: platformReason });
      }
    }
  }
  return skipped;
}

export function planCodexBrowserRun(worktree: BrowserWorktree, selection: BrowserSelection, environment: NodeJS.ProcessEnv, platform = process.platform, feedback: z.input<typeof feedbackSchema> = {}) {
  const staticFeedback = feedbackSchema.parse(feedback);
  if (platform !== "darwin") throw new Error("Localhost-only browser execution currently requires macOS sandbox-exec; no unrestricted fallback.");
  if (!environment.WISEEFF_RUNTIME_LANE) throw new Error("An explicit WISEEFF_RUNTIME_LANE is required.");
  const envFile = resolve(worktree.root, ".env");
  const fileConfig = existsSync(envFile) ? parse(readFileSync(envFile, "utf8")) : {};
  environment = { ...fileConfig, ...Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined)) };
  const localFile = resolve(worktree.root, ".env.local");
  const localConfig = existsSync(localFile) ? parse(readFileSync(localFile, "utf8")) : {};
  for (const name of ["DATABASE_URL", "TEST_DATABASE_URL", "HOST", "PORT", "OBJECT_STORE_MODE", "OBJECT_STORE_ROOT", "WISEEFF_RUNTIME_LANE", "WISEEFF_API_PORT", "WISEEFF_FRONTEND_PORT", "WISEEFF_LOCAL_BRIDGE_PROXY_URL", "VITE_WISEEFF_API_BASE_URL", "WISEEFF_ACCEPTANCE_FRONTEND_URL", "AUTH_MODE", "AUTH_PROVIDER", ...authNames]) {
    if (localConfig[name] !== undefined) throw new Error(`Runtime override .env.local ${name} is not allowed.`);
  }
  if (worktree.gitDir === worktree.commonDir || !relative(resolve(worktree.commonDir, "worktrees"), worktree.gitDir).match(/^[^./][^/]*$/)) {
    throw new Error("Run from a dedicated worktree, never the main checkout.");
  }
  if (!worktree.branch.startsWith("codex/")) throw new Error("A codex/<task> task branch is required.");
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
  const skipped = browserPlatformSkips(worktree.root, platform).filter((skip) => skip.suite === "quality" || selection.acceptanceSpecs.some((file) => file === skip.file));
  selection = { ...selection, acceptanceSpecs: selection.acceptanceSpecs.filter((file) => !skipped.some((skip) => skip.file === file)) };
  const env: NodeJS.ProcessEnv = { ...environment, TMPDIR: userTempDirectory, HOST: "127.0.0.1", OBJECT_STORE_MODE: "local", WISEEFF_ACCEPTANCE_ENV_FILE: "/dev/null" };
  for (const name of Object.keys(env)) if (/^(?:(?:https?|all)_proxy|npm_config_(?:https?_)?proxy)$/i.test(name)) delete env[name];
  env.NO_PROXY = "*";
  env.no_proxy = "*";
  const lane = applyPlaywrightRuntimeLane(env)!;
  const command = (suite: "quality" | "acceptance", filters: string[]) => ({
    suite,
    command: "/usr/bin/sandbox-exec",
    args: ["-p", localhostProfile, process.execPath, resolve(worktree.root, "node_modules/playwright/cli.js"),
      "test", "--config", `playwright.${suite}.config.ts`, ...filters],
    report: `${lane.outputDir}/${suite}/results.json`,
  });
  const qualityFilters = ["--grep", selection.qualityGrep!];
  if (skipped.some((skip) => skip.project === "visual")) {
    qualityFilters.push(...["runtime-warmup", "a11y", "consistency", "compact", "responsive"].map((project) => `--project=${project}`));
    const files = skipped.filter((skip) => skip.suite === "quality" && skip.file).map((skip) => skip.file!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (files.length) qualityFilters.push(`^(?!.*(?:${files.join("|")})$).*`);
  }
  const commands = [command("quality", qualityFilters), command("acceptance", selection.acceptanceSpecs.map((spec) => `${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))];
  selection = { ...selection, commands: commands.map((entry) => ["playwright", ...entry.args.slice(4)].join(" ")) };
  return {
    worktree, selection, env, platform, skipped, feedback: staticFeedback,
    lane: { id: lane.id, baseURL: lane.baseURL, apiURL: lane.apiURL, databaseName: decodeURIComponent(new URL(lane.databaseUrl).pathname.slice(1)), objectStoreRoot: lane.objectStoreRoot, outputDir: lane.outputDir, reportDir: lane.reportDir },
    commands,
  };
}

type LaunchOptions = { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit"; shell: false; suite: "quality" | "acceptance" };
type LaunchResult = { status: number | null; error?: Error; signal: NodeJS.Signals | null; block?: BrowserBlock; authProbe?: AuthProbe };
type Launch = (command: string, args: string[], options: LaunchOptions) => LaunchResult | Promise<LaunchResult>;

async function probeLanePort(port: number): Promise<"free" | "busy" | "error"> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE" ? "busy" : "error"));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close((error) => resolve(error ? "error" : "free")));
  });
}

export async function checkCodexLanePorts(plan: ReturnType<typeof planCodexBrowserRun>, probe = probeLanePort): Promise<BrowserBlock | null> {
  const busy: number[] = [];
  for (const url of [plan.lane.apiURL, plan.lane.baseURL]) {
    const port = Number(new URL(url).port);
    const status = await probe(port);
    if (status === "error") return { reason: "lane port check failed", suite: null, ports: [port] };
    if (status === "busy") busy.push(port);
  }
  return busy.length ? { reason: "lane ports in use", suite: null, ports: busy } : null;
}

async function localHttpStatus(url: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<number> {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1") throw new Error("Only lane loopback HTTP probes are allowed.");
  return new Promise((resolve, reject) => {
    const probe = request(target, { headers, signal }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
    probe.setTimeout(4_000, () => probe.destroy(new Error("probe-timeout")));
    probe.once("error", reject);
    probe.end();
  });
}

type SuiteRuntime = {
  spawn: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit"; shell: false; detached: true }) => ChildProcess;
  stop: (child: ChildProcess) => Promise<void>;
  request: typeof localHttpStatus;
};

export async function launchCodexBrowserSuite(command: string, args: string[], options: LaunchOptions, runtime: SuiteRuntime = { spawn, stop: stopOwnedProcessGroup, request: localHttpStatus }): Promise<LaunchResult> {
  const children: ChildProcess[] = [];
  const controller = new AbortController();
  let interrupted: NodeJS.Signals | null = null;
  const interrupt = (signal: NodeJS.Signals) => { interrupted = signal; controller.abort(new Error("interrupted")); };
  const onInterrupt = () => interrupt("SIGINT");
  const onTerminate = () => interrupt("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  let result: LaunchResult = { status: null, signal: null };
  let stopping = false;
  const start = (childArgs: string[], env: NodeJS.ProcessEnv) => {
    const child = runtime.spawn(command, childArgs, { cwd: options.cwd, env, stdio: "inherit", shell: false, detached: true });
    if (!child.pid) {
      child.once("error", () => undefined);
      throw new Error("runtime-launch-error");
    }
    children.push(child);
    child.once("error", () => controller.abort(new Error("runtime-launch-error")));
    return child;
  };
  try {
    const servers = buildPlaywrightWebServers({ baseURL: options.env.WISEEFF_ACCEPTANCE_FRONTEND_URL!, apiURL: options.env.VITE_WISEEFF_API_BASE_URL!, reuseExistingServer: false,
      ...(options.suite === "acceptance" ? { authMode: "production", includeXiaozeProactive: true, projectConfigurationWorkbenchEnabled: true } : {}),
    }, options.env) as Array<{ env?: NodeJS.ProcessEnv; url?: string }>;
    const apiEnv = { ...options.env, ...servers[0].env };
    const browserEnv = { ...options.env, ...servers[1].env };
    if (options.suite === "quality" && options.env.WISEEFF_QUALITY_SKIP_SEED !== "true") {
      const seed = start([...args.slice(0, 2), process.execPath, resolve(options.cwd, "node_modules/tsx/dist/cli.mjs"), "scripts/browser-seed-contract.ts"], options.env);
      if (await waitForOwnedProcessGroupExit(seed, { signal: controller.signal }) !== 0) throw new Error("quality-seed-failed");
      await runtime.stop(seed);
      children.pop();
    }
    for (const [index, server] of servers.entries()) {
      const serverArgs = index === 0
        ? [process.execPath, resolve(options.cwd, "node_modules/tsx/dist/cli.mjs"), "watch", "server/index.ts"]
        : [process.execPath, resolve(options.cwd, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", new URL(options.env.WISEEFF_ACCEPTANCE_FRONTEND_URL!).port, "--strictPort"];
      const child = start([...args.slice(0, 2), ...serverArgs], { ...options.env, ...server.env });
      child.once("close", () => { if (!stopping) controller.abort(new Error("runtime-exited")); });
      const deadline = Date.now() + 60_000;
      while (true) {
        controller.signal.throwIfAborted();
        try { if (await runtime.request(server.url!, {}, controller.signal) === 200) break; } catch { controller.signal.throwIfAborted(); }
        if (Date.now() >= deadline) throw new Error("runtime-readiness-timeout");
        await wait(100, undefined, { signal: controller.signal });
      }
      if (index === 1 && await runtime.request(new URL("/src/main.tsx", server.url).href, {}, controller.signal) !== 200) throw new Error("frontend-transform-failed");
    }
    const actor = castByRole.admin;
    const mode = apiEnv.AUTH_MODE === "development" ? "development" : "production";
    const authorization = mode === "development" ? undefined : options.suite === "quality"
      ? resolveApiAuthorization(browserEnv)
      : createBearerTokenForUser(actor.userId, actor.email, actor.name, ACCEPTANCE_ORGANIZATION.id, apiEnv);
    const headers: Record<string, string> = mode === "development" ? { "x-wiseeff-user": options.suite === "quality" ? developmentAuthContext.user.id : actor.userId } : authorization ? { Authorization: authorization } : {};
    let httpStatus: number | null = null;
    for (const baseURL of [options.env.VITE_WISEEFF_API_BASE_URL, options.env.WISEEFF_ACCEPTANCE_FRONTEND_URL]) {
      try { httpStatus = await runtime.request(`${baseURL}/api/v1/me`, headers, controller.signal); } catch { httpStatus = null; }
      if (httpStatus !== 200) break;
    }
    result.authProbe = { suite: options.suite, mode, mechanism: mode === "development" ? "development-header" : "bearer", httpStatus };
    if (httpStatus !== 200) result.block = { reason: "authentication probe failed", suite: options.suite, httpStatus };
    else {
      const child = start(args, { ...options.env, WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true", ...(options.suite === "quality" ? { WISEEFF_QUALITY_SKIP_SEED: "true" } : {}) });
      result.status = await waitForOwnedProcessGroupExit(child, { signal: controller.signal });
      result.signal = child.signalCode;
    }
  } catch {
    result = { ...result, status: null, signal: interrupted, block: { reason: interrupted ? "runtime interrupted" : "runtime startup failed", suite: options.suite } };
  } finally {
    stopping = true;
    for (const child of children.reverse()) {
      try { await runtime.stop(child); }
      catch { result.block = { reason: "runtime teardown failed", suite: options.suite }; }
    }
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
  return result;
}

function assertLocalDestination(root: string, destination: string) {
  let existing = resolve(root, destination);
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = resolve(existing, "..");
  const actual = realpathSync(existing);
  if (actual !== root) worktreePath(root, actual);
}

export async function runCodexBrowserPlan(plan: ReturnType<typeof planCodexBrowserRun>, changedPaths: string[], launch: Launch = launchCodexBrowserSuite, checkPorts = checkCodexLanePorts) {
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
    const runs: z.infer<typeof runSchema>[] = [];
    const authProbes: AuthProbe[] = [];
    let block: BrowserBlock | null = !missingAuth(plan.env, plan.selection).length && plan.feedback.staticCoverage?.status === "failed" ? { reason: "static checks failed", suite: null } : null;
    for (const command of block || missingAuth(plan.env, plan.selection).length ? [] : plan.commands) {
      if (command.suite === "acceptance" && !plan.selection.acceptanceSpecs.length) {
        runs.push({ suite: command.suite, status: "skipped", exitCode: null, durationMs: 0, report: command.report, error: platformReason, reportErrors: 0, tests: [] });
        continue;
      }
      block = await checkPorts(plan);
      if (block) { block.suite = command.suite; break; }
      const reportPath = resolve(root, command.report);
      rmSync(reportPath, { force: true });
      const start = Date.now();
      let result: LaunchResult;
      try { result = await launch(command.command, command.args, { cwd: root, env: plan.env, stdio: "inherit", shell: false, suite: command.suite }); }
      catch { result = { status: null, error: new Error("launch-error"), signal: null }; }
      if (result.authProbe) authProbes.push(result.authProbe);
      let run: z.infer<typeof runSchema>;
      try {
        run = summarizeBrowserReport(plan, command.suite, existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null, result.status, Date.now() - start);
      } catch {
        run = summarizeBrowserReport(plan, command.suite, null, result.status, Date.now() - start);
        run.error = "invalid-report";
      }
      if (result.error || result.signal) { run.status = "failed"; run.error = result.signal ? "interrupted" : "launch-error"; }
      runs.push(run);
      if (result.block) { block = result.block; break; }
      if (result.signal) { block = { reason: "runtime interrupted", suite: command.suite }; break; }
    }
    if (!block && !missingAuth(plan.env, plan.selection).length) block = await checkPorts(plan);
    const evidence = buildCodexBrowserEvidence(plan, changedPaths, runs, startedAt, block, authProbes);
    const temporary = `${evidencePath}.tmp`;
    assertLocalDestination(root, temporary);
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, evidencePath);
    return evidence;
  } finally {
    rmdirSync(lock);
  }
}

export async function runCodexBrowserCli(args: string[] = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, options: {
    base: { type: "string" }, check: { type: "string" }, "spot-check": { type: "string" },
    reviewer: { type: "string" }, outcome: { type: "string" }, notes: { type: "string" },
  }, allowPositionals: true });
  const reviewOptions = [values.reviewer, values.outcome, values.notes];
  if (values["spot-check"] !== undefined) {
    if (values.base !== undefined || values.check !== undefined || positionals.length) throw new Error("--spot-check cannot be combined with --check or a browser run.");
    const spotCheck = spotCheckSchema.parse({ reviewer: values.reviewer, outcome: values.outcome, notes: values.notes, checkedAt: new Date().toISOString() });
    const evidencePath = resolve(values["spot-check"]);
    const initial = codexBrowserEvidenceSchema.parse(JSON.parse(readFileSync(evidencePath, "utf8")));
    const root = realpathSync(initial.worktree.root);
    assertLocalDestination(root, evidencePath);
    const lock = resolve(root, initial.lane.outputDir, ".codex-browser-lock");
    assertLocalDestination(root, lock);
    mkdirSync(lock);
    try {
      const evidence = codexBrowserEvidenceSchema.parse({ ...JSON.parse(readFileSync(evidencePath, "utf8")), spotCheck });
      const temporary = `${evidencePath}.tmp`;
      assertLocalDestination(root, temporary);
      writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, evidencePath);
      console.log(`Recorded browser spot-check: ${spotCheck.outcome}; reviewer: ${spotCheck.reviewer}`);
      process.exitCode = evidence.status === "passed" && completedStatic(evidence.selection.staticCoverage) && spotCheck.outcome === "passed" ? 0 : 1;
    } finally {
      rmdirSync(lock);
    }
    return;
  }
  if (reviewOptions.some((value) => value !== undefined)) throw new Error("--reviewer, --outcome and --notes require --spot-check <evidence.json>.");
  if (values.check) {
    if (values.base || positionals.length) throw new Error("--check cannot be combined with a browser run.");
    const evidence = codexBrowserEvidenceSchema.parse(JSON.parse(readFileSync(values.check, "utf8")));
    console.log(`Local browser evidence: ${evidence.status}; static: ${evidence.selection.staticCoverage?.status ?? "not-recorded"}; CI: not-run; spot-check: ${evidence.spotCheck?.outcome ?? "pending"}`);
    process.exitCode = evidence.status === "passed" && completedStatic(evidence.selection.staticCoverage) && evidence.spotCheck?.outcome !== "failed" ? 0 : 1;
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
  let changes: ReturnType<typeof readStaticChanges> | undefined;
  if (values.base !== undefined) {
    changes = readStaticChanges(root, values.base);
    paths = changes.paths;
  }
  const selection = await createVitestImpact(paths, root, { executeStatic: true, base: changes?.base, deletedPaths: changes?.deletedPaths });
  const plan = planCodexBrowserRun(worktree, selection.browser, process.env, process.platform, { base: selection.base, staticCoverage: selection.staticCoverage });
  if (!existsSync("/usr/bin/sandbox-exec")) throw new Error("sandbox-exec is unavailable; refusing unrestricted execution.");
  const evidence = await runCodexBrowserPlan(plan, selection.changedPaths);
  console.log(`${evidence.status}: ${plan.lane.outputDir}/codex-browser-evidence.json (coordinator spot-check pending)`);
  process.exitCode = evidence.status === "passed" && completedStatic(evidence.selection.staticCoverage) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runCodexBrowserCli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
