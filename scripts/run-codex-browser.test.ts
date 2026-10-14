import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { browserPlatformSkips, buildCodexBrowserEvidence, checkCodexLanePorts, codexBrowserEvidenceSchema, launchCodexBrowserSuite, planCodexBrowserRun, runCodexBrowserPlan, summarizeBrowserReport } from "./run-codex-browser";
import { selectBrowserImpact } from "./test-impact";
import { buildPlaywrightWebServers } from "../playwright.shared";
import { createBearerTokenForUser } from "../e2e/acceptance/helpers/runtime";
import { castByRole } from "../e2e/acceptance/helpers/cast";

const worktree = {
  root: "/tmp/task", gitDir: "/tmp/main/.git/worktrees/task", commonDir: "/tmp/main/.git",
  branch: "codex/ui-t-1179", head: "9cde32f5f0167855ca5b239c8ef68a041f528143", dirty: true,
};
const environment = { WISEEFF_RUNTIME_LANE: "7", DATABASE_URL: "postgres://local:secret@127.0.0.1:5432/wiseeff", AUTH_TOKEN_ISSUER: "test-issuer", AUTH_TOKEN_HMAC_SECRET: "test-hmac-secret" };
const selection = selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx"], {
  "e2e/acceptance/logs.spec.ts": ["/logs"],
  "e2e/acceptance/organization.spec.ts": ["/organization"],
});

describe("Codex browser runner", () => {
  it("awaits exact process-group teardown and free-port checks before launching the next suite", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    const events: string[] = [];
    try {
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, { ...environment, AUTH_MODE: "development" }, "darwin");
      let sequence = 0;
      const result = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], (command, args, options) => launchCodexBrowserSuite(command, args, options, {
        spawn: (executable, childArgs, childOptions) => {
          const name = childArgs.includes("server/index.ts") ? "api" : childArgs.includes("--strictPort") ? "frontend" : "tests";
          events.push(`${options.suite}:start:${name}`);
          expect(executable).toBe("/usr/bin/sandbox-exec");
          expect(childArgs.slice(0, 2)).toEqual(args.slice(0, 2));
          expect(childOptions.detached).toBe(true);
          expect(childOptions.env).toMatchObject({ DATABASE_URL: plan.env.DATABASE_URL, WISEEFF_RUNTIME_LANE: "7", AUTH_TOKEN_HMAC_SECRET: "test-hmac-secret" });
          if (name === "api") expect(childOptions.env.AUTH_MODE).toBe(options.suite === "quality" ? "development" : "production");
          const child = Object.assign(new EventEmitter(), { pid: ++sequence, exitCode: null, signalCode: null, label: `${options.suite}:${name}` });
          if (name === "tests") {
            expect(childOptions.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME).toBe("true");
            queueMicrotask(() => child.emit("close", 1, null));
          }
          return child;
        },
        request: async (url, headers) => {
          if (url.endsWith("/api/v1/me")) {
            events.push(`${options.suite}:auth:${new URL(url).port}`);
            expect([`${plan.lane.apiURL}/api/v1/me`, `${plan.lane.baseURL}/api/v1/me`]).toContain(url);
            const actor = castByRole.admin;
            expect(headers).toEqual(options.suite === "quality" ? { "x-wiseeff-user": actor.userId } : {
              Authorization: createBearerTokenForUser(actor.userId, actor.email, actor.name, undefined, plan.env),
            });
          }
          return 200;
        },
        stop: async (child) => { await Promise.resolve(); events.push(`stop:${child.label}`); },
      }), async () => { events.push("ports"); return null; });
      expect(result.status).toBe("failed");
      expect(result.authProbes).toEqual([
        { suite: "quality", mode: "development", mechanism: "development-header", httpStatus: 200 },
        { suite: "acceptance", mode: "production", mechanism: "bearer", httpStatus: 200 },
      ]);
      expect(events).toEqual([
        "ports", "quality:start:api", "quality:start:frontend", "quality:auth:20014", "quality:auth:20015", "quality:start:tests", "stop:quality:tests", "stop:quality:frontend", "stop:quality:api",
        "ports", "acceptance:start:api", "acceptance:start:frontend", "acceptance:auth:20014", "acceptance:auth:20015", "acceptance:start:tests", "stop:acceptance:tests", "stop:acceptance:frontend", "stop:acceptance:api", "ports",
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    { AUTH_MODE: "development", AUTH_TOKEN_ISSUER: undefined, AUTH_TOKEN_HMAC_SECRET: undefined },
    { AUTH_MODE: "production", VITE_WISEEFF_API_AUTHORIZATION: "Bearer quality-browser-token", M5_SMOKE_AUTHORIZATION: "Bearer unused-smoke-token" },
    { AUTH_MODE: "production", M5_SMOKE_AUTHORIZATION: "Bearer quality-browser-token" },
  ])("probes quality with its effective browser auth without inventing a token: %j", async (authEnv) => {
    const plan = planCodexBrowserRun(worktree, selection, { ...environment, ...authEnv }, "darwin");
    const probes: string[] = [];
    let launches = 0;
    const result = await launchCodexBrowserSuite(plan.commands[0].command, plan.commands[0].args, {
      cwd: worktree.root, env: plan.env, stdio: "inherit", shell: false, suite: "quality",
    }, {
      spawn: () => {
        const child = Object.assign(new EventEmitter(), { pid: ++launches, exitCode: null, signalCode: null });
        if (launches === 3) queueMicrotask(() => child.emit("close", 0, null));
        return child;
      },
      request: async (url, headers) => {
        if (url.endsWith("/api/v1/me")) {
          probes.push(url);
          expect(headers).toEqual(authEnv.AUTH_MODE === "development" ? { "x-wiseeff-user": castByRole.admin.userId } : { Authorization: "Bearer quality-browser-token" });
        }
        return 200;
      },
      stop: async () => undefined,
    });
    expect(result.block).toBeUndefined();
    expect(result.status).toBe(0);
    expect(probes).toEqual([`${plan.lane.apiURL}/api/v1/me`, `${plan.lane.baseURL}/api/v1/me`]);
  });

  it("blocks busy lane ports and failed authenticated probes before tests, and still tears down servers", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, environment, "darwin");
      const checked: number[] = [];
      const busy = await checkCodexLanePorts(plan, async (port) => { checked.push(port); return port === 20015 ? "busy" : "free"; });
      expect(checked).toEqual([20014, 20015]);
      expect(busy).toMatchObject({ reason: "lane ports in use", ports: [20015] });
      const blocked = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], () => { throw new Error("must not launch"); }, async () => busy);
      expect(blocked.status).toBe("blocked: lane ports in use");
      expect(blocked.runs).toEqual([]);
      const stopped: number[] = [];
      let launches = 0;
      const evidence = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], (command, args, options) => launchCodexBrowserSuite(command, args, options, {
        spawn: () => Object.assign(new EventEmitter(), { pid: ++launches, exitCode: null, signalCode: null }),
        request: async (url) => url.endsWith("/api/v1/me") ? 401 : 200,
        stop: async (child) => { stopped.push(child.pid); },
      }), async () => null);
      expect(evidence).toMatchObject({ status: "blocked: authentication probe failed", block: { suite: "quality", httpStatus: 401 } });
      expect(evidence.authProbes).toEqual([{ suite: "quality", mode: "production", mechanism: "bearer", httpStatus: 401 }]);
      expect(launches).toBe(2);
      expect(stopped).toEqual([2, 1]);
      expect(JSON.stringify(evidence)).not.toContain("test-hmac-secret");
      expect(codexBrowserEvidenceSchema.parse(evidence).status).toBe(evidence.status);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not start the next suite when process-group cleanup fails, and does not leak cleanup errors", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, environment, "darwin");
      let launches = 0;
      const stopped: number[] = [];
      const evidence = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], (command, args, options) => launchCodexBrowserSuite(command, args, options, {
        spawn: () => Object.assign(new EventEmitter(), { pid: ++launches, exitCode: null, signalCode: null }),
        request: async (url) => url.endsWith("/api/v1/me") ? 401 : 200,
        stop: async (child) => { stopped.push(child.pid); if (child.pid === 2) throw new Error("secret-cleanup-detail"); },
      }), async () => null);
      expect(evidence.status).toBe("blocked: runtime teardown failed");
      expect(stopped).toEqual([2, 1]);
      expect(launches).toBe(2);
      expect(JSON.stringify(evidence)).not.toContain("secret-cleanup-detail");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("propagates the same dotenv auth/provider settings as a plain Playwright launch without overriding lane ownership", () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      writeFileSync(resolve(root, ".env"), 'AUTH_MODE=production\nAUTH_PROVIDER=local\nAUTH_TOKEN_ISSUER=file-issuer\nAUTH_TOKEN_HMAC_SECRET=file-secret\nM5_SMOKE_AUTHORIZATION="Bearer file-smoke-token"\nDATABASE_URL=postgres://file@127.0.0.1/file_db\nHOST=remote.example\n');
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, { ...environment, AUTH_MODE: "development", AUTH_TOKEN_HMAC_SECRET: undefined, HTTP_PROXY: "http://remote.example:8080", https_proxy: "http://remote.example:8080" }, "darwin");
      expect(plan.env).toMatchObject({ AUTH_MODE: "development", AUTH_PROVIDER: "local", AUTH_TOKEN_ISSUER: "test-issuer", AUTH_TOKEN_HMAC_SECRET: "file-secret", M5_SMOKE_AUTHORIZATION: "Bearer file-smoke-token", DATABASE_URL: "postgres://local:secret@127.0.0.1:5432/wiseeff_lane_7", WISEEFF_RUNTIME_LANE: "7", HOST: "127.0.0.1" });
      const servers = buildPlaywrightWebServers({ baseURL: plan.lane.baseURL, apiURL: plan.lane.apiURL, reuseExistingServer: false, authMode: "production" }, plan.env) as Array<{ env: NodeJS.ProcessEnv }>;
      expect(servers[0].env).toMatchObject({ AUTH_MODE: "production", AUTH_PROVIDER: "hmac", AUTH_TOKEN_ISSUER: "test-issuer", AUTH_TOKEN_HMAC_SECRET: "file-secret", DATABASE_URL: plan.env.DATABASE_URL });
      expect(servers[1].env).toMatchObject({ VITE_WISEEFF_API_AUTHORIZATION: "Bearer file-smoke-token", VITE_WISEEFF_API_BASE_URL: plan.lane.baseURL, WISEEFF_DEV_API_PROXY_URL: plan.lane.apiURL });
      expect(plan.env).toMatchObject({ NO_PROXY: "*", no_proxy: "*" });
      expect(plan.env.HTTP_PROXY).toBeUndefined();
      expect(plan.env.https_proxy).toBeUndefined();
      writeFileSync(resolve(root, ".env.local"), 'DATABASE_URL=postgres://other@127.0.0.1/shared\n');
      expect(() => planCodexBrowserRun({ ...worktree, root }, selection, environment, "darwin")).toThrow(/\.env\.local.*DATABASE_URL/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("excludes baseline projects/specs on non-Linux hosts and records platform skips", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      mkdirSync(resolve(root, "e2e/acceptance"), { recursive: true });
      writeFileSync(resolve(root, "e2e/acceptance/baseline.spec.ts"), 'await expect(page).toHaveScreenshot("baseline.png");');
      mkdirSync(resolve(root, "e2e/quality"), { recursive: true });
      writeFileSync(resolve(root, "e2e/quality/other.quality.spec.ts"), 'await expect(image).toMatchSnapshot("baseline.png");');
      const requested = { ...selection, acceptanceSpecs: [...selection.acceptanceSpecs, "e2e/acceptance/baseline.spec.ts"] };
      const plan = planCodexBrowserRun({ ...worktree, root }, requested, environment, "darwin");
      expect(plan.selection.acceptanceSpecs).toEqual(selection.acceptanceSpecs);
      expect(plan.commands[0].args).toContain("--project=a11y");
      expect(plan.commands[0].args).not.toContain("--project=visual");
      const fileFilter = new RegExp(plan.commands[0].args.at(-1)!);
      expect(fileFilter.test(resolve(root, "e2e/quality/other.quality.spec.ts"))).toBe(false);
      expect(fileFilter.test(resolve(root, "e2e/quality/a11y.quality.spec.ts"))).toBe(true);
      expect(plan.commands[1].args.join(" ")).not.toContain("baseline");
      const evidence = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], () => ({ status: 1, signal: null }), async () => null);
      expect(evidence.skipped).toEqual(expect.arrayContaining([
        expect.objectContaining({ suite: "quality", project: "visual", status: "skipped", reason: "platform: Linux-only baselines" }),
        expect.objectContaining({ suite: "acceptance", file: "e2e/acceptance/baseline.spec.ts", status: "skipped", reason: "platform: Linux-only baselines" }),
      ]));
      expect(browserPlatformSkips(root, "linux")).toEqual([]);
      expect(browserPlatformSkips(root, "win32")).toEqual(browserPlatformSkips(root, "darwin"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("blocks before either runtime starts when auth configuration is missing, without exposing values", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      for (const [supplied, missing] of [
        [{}, "AUTH_TOKEN_ISSUER, AUTH_TOKEN_HMAC_SECRET"],
        [{ AUTH_TOKEN_ISSUER: "private-issuer" }, "AUTH_TOKEN_HMAC_SECRET"],
        [{ AUTH_TOKEN_ISSUER: " ", AUTH_TOKEN_HMAC_SECRET: "private-secret" }, "AUTH_TOKEN_ISSUER"],
      ] as const) {
        const plan = planCodexBrowserRun({ ...worktree, root }, selection, { ...environment, AUTH_TOKEN_ISSUER: undefined, AUTH_TOKEN_HMAC_SECRET: undefined, ...supplied }, "darwin");
        let launches = 0;
        const evidence = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], () => { launches++; return { status: 0, signal: null }; }, async () => null);
        expect(evidence.status).toBe(`blocked: missing ${missing}`);
        expect(evidence.runs).toEqual([]);
        expect(launches).toBe(0);
        const saved = readFileSync(resolve(root, plan.lane.outputDir, "codex-browser-evidence.json"), "utf8");
        expect(codexBrowserEvidenceSchema.parse(JSON.parse(saved)).status).toBe(evidence.status);
        expect(saved).not.toMatch(/private-issuer|private-secret/);
      }
      writeFileSync(resolve(root, ".env"), 'AUTH_TOKEN_ISSUER="file-issuer"\nAUTH_TOKEN_HMAC_SECRET="file-secret"\nHOST=remote.example\n');
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, { ...environment, AUTH_TOKEN_HMAC_SECRET: undefined }, "darwin");
      expect(plan.env).toMatchObject({ AUTH_TOKEN_ISSUER: "test-issuer", AUTH_TOKEN_HMAC_SECRET: "file-secret", HOST: "127.0.0.1" });
      expect(JSON.stringify(await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], () => ({ status: 1, signal: null }), async () => null))).not.toMatch(/file-secret|file-issuer|test-issuer|test-hmac-secret/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("allows tsx Unix-socket IPC only in the user's temp directory while retaining loopback-only IP rules", () => {
    const plan = planCodexBrowserRun(worktree, selection, environment, "darwin");
    const profile = plan.commands[0].args[1];
    const temporary = realpathSync(tmpdir());
    const ipcPath = JSON.stringify(resolve(temporary, `tsx-${process.geteuid?.() ?? userInfo().username}`));
    expect(plan.env.TMPDIR).toBe(temporary);
    expect(profile).toContain("(deny network*)");
    expect(profile.match(/^\(allow network[^\n]+/gm)).toEqual([
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
      `(allow network-bind (local unix-socket (subpath ${ipcPath})))`,
      `(allow network-inbound (local unix-socket (subpath ${ipcPath})))`,
      `(allow network-outbound (remote unix-socket (subpath ${ipcPath})))`,
    ]);
    expect(plan.commands[1].args[1]).toBe(profile);
  });

  it("runs the selector's exact subset in an isolated local lane without a shell or git writes", () => {
    const plan = planCodexBrowserRun(worktree, selection, environment, "darwin");

    expect(plan.lane).toMatchObject({ id: "7", databaseName: "wiseeff_lane_7", baseURL: "http://127.0.0.1:20015" });
    expect(plan.env).toMatchObject({ DATABASE_URL: "postgres://local:secret@127.0.0.1:5432/wiseeff_lane_7", HOST: "127.0.0.1", OBJECT_STORE_MODE: "local" });
    expect(plan.commands.map(({ suite, args }) => ({ suite, args: args.slice(4) }))).toEqual([
      { suite: "quality", args: ["test", "--config", "playwright.quality.config.ts", "--grep", selection.qualityGrep, ...["runtime-warmup", "a11y", "consistency", "compact", "responsive"].map((project) => `--project=${project}`)] },
      { suite: "acceptance", args: ["test", "--config", "playwright.acceptance.config.ts", "e2e/acceptance/logs\\.spec\\.ts$"] },
    ]);
    expect(plan.commands.every((command) => command.command === "/usr/bin/sandbox-exec")).toBe(true);
    expect(JSON.stringify(plan.lane)).not.toContain("secret");
  });

  it("fails closed before launch for unsafe worktrees, networks, runtime overrides or empty browser selections", () => {
    const plan = (overrides: Partial<typeof worktree> = {}, env: NodeJS.ProcessEnv = environment, platform = "darwin") =>
      planCodexBrowserRun({ ...worktree, ...overrides }, selection, env, platform as NodeJS.Platform);
    expect(() => plan({ gitDir: worktree.commonDir })).toThrow(/dedicated worktree/i);
    expect(() => plan({ branch: "main" })).toThrow(/task branch/i);
    expect(() => plan({}, { ...environment, WISEEFF_RUNTIME_LANE: undefined })).toThrow(/lane/i);
    expect(() => plan({}, { ...environment, DATABASE_URL: "postgres://local@remote.example/wiseeff" })).toThrow(/localhost/i);
    expect(() => plan({}, { ...environment, DATABASE_URL: `${environment.DATABASE_URL}?host=remote.example` })).toThrow(/query/i);
    expect(() => plan({}, { ...environment, DATABASE_URL: "postgres://local@127.0.0.1/wiseeff_lane_8" })).toThrow(/another lane/i);
    expect(() => plan({}, { ...environment, WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true" })).toThrow(/override/i);
    expect(() => plan({}, { ...environment, WISEEFF_QUALITY_LANE: "consistency-1" })).toThrow(/override/i);
    expect(() => plan({}, { ...environment, OBJECT_STORE_ROOT: "/tmp/shared" })).toThrow(/worktree/i);
    expect(() => plan({}, environment, "linux")).toThrow(/macOS/i);
    expect(() => planCodexBrowserRun(worktree, selectBrowserImpact(["docs/FRONTEND.md"], {}), environment, "darwin")).toThrow(/empty/i);
  });

  it("records selection, observed themes, per-attempt results and artifacts without claiming skipped or absent runs passed", () => {
    const plan = planCodexBrowserRun(worktree, selection, environment, "darwin");
    const report = {
      config: { rootDir: "/tmp/task/e2e/quality" }, errors: [],
      suites: [{ title: "logs", specs: [{ title: "read-only /logs?tab=history (dark)", file: "consistency.quality.spec.ts", tests: [{
        projectName: "consistency", expectedStatus: "passed", status: "expected",
        results: [{ status: "passed", retry: 0, duration: 123, attachments: [{ name: "capture", contentType: "image/png", path: "/tmp/task/test-results/lanes/7/quality/capture.png" }] }],
      }] }] }],
    };
    const run = summarizeBrowserReport(plan, "quality", report, 0, 150);
    expect(run).toMatchObject({ status: "passed", durationMs: 150, tests: [{
      file: "e2e/quality/consistency.quality.spec.ts", routes: ["/logs?tab=history"], theme: "dark",
      outcome: "expected", attempts: [{ status: "passed", durationMs: 123, retry: 0, artifacts: [{ path: "test-results/lanes/7/quality/capture.png" }] }],
    }] });
    const missing = summarizeBrowserReport(plan, "acceptance", null, 1, 10);
    const evidence = buildCodexBrowserEvidence(plan, ["src/features/log-analysis/LogsPage.tsx"], [run, missing]);
    expect(codexBrowserEvidenceSchema.parse(evidence)).toMatchObject({ version: 1, status: "failed", themes: ["dark"], spotCheck: null });
    expect(evidence.selection.browser.acceptanceSpecs).toEqual(["e2e/acceptance/logs.spec.ts"]);
    expect(JSON.stringify(evidence)).not.toContain("secret");
    expect(summarizeBrowserReport(plan, "quality", { ...report, suites: [] }, 0, 1).status).toBe("failed");
    expect(summarizeBrowserReport(plan, "quality", { ...report, errors: [{ message: "setup failed" }] }, 0, 1).status).toBe("failed");
    report.suites[0].specs[0].tests[0].status = "skipped";
    report.suites[0].specs[0].tests[0].results[0].status = "skipped";
    expect(summarizeBrowserReport(plan, "quality", report, 0, 1).status).toBe("failed");
    expect(() => codexBrowserEvidenceSchema.parse({ ...evidence, status: "passed" })).toThrow();
    expect(() => summarizeBrowserReport(plan, "quality", {}, 0, 1)).toThrow();
    expect(() => summarizeBrowserReport(plan, "acceptance", { ...report, config: { rootDir: "/tmp/task/e2e/acceptance" } }, 0, 1)).toThrow(/selection/i);
  });

  it("launches sequentially and persists failed evidence rather than trusting a stale report", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, environment, "darwin");
      const output = resolve(root, plan.lane.outputDir, "acceptance");
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, "results.json"), "stale green report");
      const launched: string[] = [];
      const result = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], (command, args, options) => {
        expect(command).toBe("/usr/bin/sandbox-exec");
        expect(options.cwd).toBe(root);
        expect(options.env?.DATABASE_URL).toContain("_lane_7");
        launched.push(args[6]);
        return { status: 1, error: undefined, signal: null };
      }, async () => null);
      expect(launched).toEqual(["playwright.quality.config.ts", "playwright.acceptance.config.ts"]);
      expect(result.status).toBe("failed");
      expect(result.runs.map((run) => run.error)).toEqual(["report-missing", "report-missing"]);
      expect(codexBrowserEvidenceSchema.parse(JSON.parse(readFileSync(resolve(root, plan.lane.outputDir, "codex-browser-evidence.json"), "utf8"))).status).toBe("failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not count warmup alone or omitted selected specs as browser coverage", () => {
    const plan = planCodexBrowserRun(worktree, selection, environment, "darwin");
    const report = {
      config: { rootDir: "/tmp/task/e2e/acceptance" }, errors: [],
      suites: [{ title: "warmup", specs: [{ title: "warm entry graph", file: "runtime-warmup.spec.ts", tests: [{
        projectName: "runtime-warmup", expectedStatus: "passed", status: "expected",
        results: [{ status: "passed", retry: 0, duration: 10, attachments: [] }],
      }] }] }],
    };
    expect(summarizeBrowserReport(plan, "acceptance", report, 0, 1).status).toBe("failed");
    report.suites[0].specs[0].file = "logs.spec.ts";
    report.suites[0].specs[0].tests[0].projectName = "Desktop Chrome";
    expect(summarizeBrowserReport(plan, "acceptance", report, 0, 1).status).toBe("passed");
    report.suites[0].specs[0].tests[0].status = "flaky";
    expect(summarizeBrowserReport(plan, "acceptance", report, 0, 1).status).toBe("failed");
    report.suites[0].specs[0].tests[0].status = "expected";
    const expanded = planCodexBrowserRun(worktree, { ...selection, acceptanceSpecs: [...selection.acceptanceSpecs, "e2e/acceptance/missing.spec.ts"] }, environment, "darwin");
    expect(summarizeBrowserReport(expanded, "acceptance", report, 0, 1).status).toBe("failed");
    expect(() => planCodexBrowserRun(worktree, selection, { ...environment, OBJECT_STORE_MODE: "s3" }, "darwin")).toThrow(/local object/i);
  });

  it("refuses dangling output symlinks instead of writing evidence outside the worktree", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    const outside = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-outside-")));
    try {
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, environment, "darwin");
      mkdirSync(resolve(root, plan.lane.outputDir), { recursive: true });
      symlinkSync(resolve(outside, "escaped.json"), resolve(root, plan.lane.outputDir, "codex-browser-evidence.json.tmp"));
      await expect(runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], () => ({ status: 1, signal: null }), async () => null)).rejects.toThrow();
      expect(existsSync(resolve(outside, "escaped.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("persists a schema-valid successful receipt without fabricating a coordinator spot-check", async () => {
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codex-browser-")));
    try {
      const plan = planCodexBrowserRun({ ...worktree, root }, selection, environment, "darwin");
      const evidence = await runCodexBrowserPlan(plan, ["src/features/log-analysis/LogsPage.tsx"], (_command, args) => {
        const suite = args[6] === "playwright.quality.config.ts" ? "quality" : "acceptance";
        const output = resolve(root, plan.lane.outputDir, suite);
        mkdirSync(output, { recursive: true });
        writeFileSync(resolve(output, "results.json"), JSON.stringify({ config: { rootDir: resolve(root, "e2e", suite) }, errors: [],
          suites: [{ title: "logs", specs: [{ title: "reads /logs (light)", file: suite === "quality" ? "a11y.quality.spec.ts" : "logs.spec.ts", tests: [{
            projectName: suite === "quality" ? "a11y" : "Desktop Chrome", expectedStatus: "passed", status: "expected",
            results: [{ status: "passed", retry: 0, duration: 12, attachments: [] }],
          }] }] }],
        }));
        return { status: 0, signal: null };
      }, async () => null);
      expect(codexBrowserEvidenceSchema.parse(evidence)).toMatchObject({ status: "passed", themes: ["light"], spotCheck: null });
      expect(evidence.runs.map((run) => run.tests[0].durationMs)).toEqual([12, 12]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
