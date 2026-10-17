import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVitestImpact, gateImplementationFiles, selectVitestImpact, type TestInventory } from "./test-impact";
import { discoverBrowserInventory } from "./browser-navigation";

const inventory: TestInventory = {
  frontend: { files: ["src/features/example/page.test.tsx", "src/components/ui/view-switch.styles.test.ts"], related: { "src/features/example/page.tsx": ["src/features/example/page.test.tsx"] } },
  server: { files: ["server/modules/example/routes.test.ts"], related: { "src/features/example/page.tsx": ["server/modules/example/routes.test.ts"] } },
  scripts: { files: ["scripts/quality-view-switch.test.ts", "scripts/run-vitest.test.ts"], related: { "src/features/example/page.tsx": ["scripts/quality-view-switch.test.ts"] } },
  bridge: { files: ["packages/device-bridge/src/client.test.ts"], related: { "src/features/example/page.tsx": ["packages/device-bridge/src/client.test.ts"] } },
};

describe("Vitest impact selection", () => {
  it("maps every package gate to implementation files and selects its gate with related tests", () => {
    const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts as Record<string, string>;
    const gates = Object.keys(scripts).filter((name) => name.endsWith(":check") || (name.startsWith("acceptance:") && /scripts\/check-/.test(scripts[name])));
    expect(Object.keys(gateImplementationFiles).sort()).toEqual(gates.sort());
    for (const gate of gates) {
      expect(gateImplementationFiles[gate].length, gate).toBeGreaterThan(0);
      for (const file of gateImplementationFiles[gate]) {
        const mapped = { ...inventory, scripts: { ...inventory.scripts, related: { [file]: [inventory.scripts.files[0]] } } };
        const selection = selectVitestImpact([file], mapped);
        expect(selection.gates, file).toContain(gate);
        expect(selection.suites.find((suite) => suite.name === "scripts")?.files).toContain(inventory.scripts.files[0]);
      }
    }
  });

  it.each([
    ["scripts/check-ui-standards.ts", "ui:check"],
    ["scripts/check-doc-governance.ts", "docs:check"],
    ["scripts/check-relative-doc-links.ts", "docs:check"],
    ["scripts/generate-db-schema-doc.ts", "docs:check"],
    ["scripts/check-openapi-contract.ts", "contract:check"],
    ["scripts/generate-openapi-contract.ts", "contract:check"],
    ["scripts/check-parameter-catalog-boundaries.ts", "parameter-catalog-boundaries:check"],
    ["scripts/check-acceptance-ci.ts", "acceptance:ci"],
  ])("selects implementation gate %s → %s", (file, gate) => {
    expect(selectVitestImpact([file], inventory).gates).toContain(gate);
  });

  it("keeps related tests in all four suites and prints their runnable commands", () => {
    const selection = selectVitestImpact(["src/features/example/page.tsx"], inventory);

    expect(selection.fullFallback).toBe(false);
    expect(selection.suites.map((suite) => [suite.name, suite.files])).toEqual([
      ["frontend", ["src/features/example/page.test.tsx"]],
      ["server", ["server/modules/example/routes.test.ts"]],
      ["scripts", ["scripts/quality-view-switch.test.ts"]],
      ["bridge", ["packages/device-bridge/src/client.test.ts"]],
    ]);
    expect(selection.commands).toEqual([
      "VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner --config vite.config.ts --passWithNoTests=false src/features/example/page.test.tsx",
      "VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner --config vitest.server.config.ts --passWithNoTests=false server/modules/example/routes.test.ts",
      "VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner --config vitest.scripts.config.ts --passWithNoTests=false scripts/quality-view-switch.test.ts",
      "VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner --config vitest.bridge.config.ts --passWithNoTests=false packages/device-bridge/src/client.test.ts",
      "npm run ui:check",
    ]);
    expect(JSON.parse(JSON.stringify(selection))).toEqual(selection);
  });

  it.each([
    "src/App.tsx", "src/main.tsx", "src/app/routes.tsx", "src/components/layout/AdminListPage.tsx",
    "src/components/ui/view-switch.tsx", "src/styles.css", "src/linear-template/linear-template.css",
    "src/test/setup.ts", "e2e/quality/consistency-routes.ts", "e2e/quality/view-switch.ts",
    ".github/workflows/ci.yml", ".github/actions/setup/action.yml", "vite.config.ts",
    "vitest.server.config.ts", "playwright.quality.config.ts", "tsconfig.app.json",
    "eslint.config.js", "package.json", "package-lock.json",
    "scripts/reset-quality-runtime.ts", "scripts/ci-required-results.ts", "scripts/test-impact.ts",
    "scripts/quality-partition.test.ts", "scripts/seed-contract.ts", "scripts/quality-seed-contract.ts",
    "src/components/common/AppShellSkeleton.tsx", "src/components/notifications/TopBarNotifications.tsx",
    "src/workbenchUi.tsx", "src/appConfig.ts",
  ])("shared change %s overrides an otherwise nonempty related selection", (file) => {
    const mapped = { ...inventory, frontend: { ...inventory.frontend, related: { ...inventory.frontend.related, [file]: [inventory.frontend.files[0]] } } };
    const selection = selectVitestImpact(["src/features/example/page.tsx", file], mapped);

    expect(selection.fullFallback).toBe(true);
    expect(selection.suites.map((suite) => suite.files)).toEqual([
      [...inventory.frontend.files].sort(), inventory.server.files, inventory.scripts.files, inventory.bridge.files,
    ]);
    expect(selection.reasons.join("\n")).toContain(file);
    expect(selection.commands[0]).toBe("VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner --config vite.config.ts --passWithNoTests=false");
  });

  it.each(["tools/unknown.ts", "src/features/unmapped.ts"])("does not hide unmapped path %s behind a mapped change", (file) => {
    const selection = selectVitestImpact(["src/features/example/page.tsx", file], inventory);
    expect(selection.fullFallback).toBe(true);
    expect(selection.reasons).toContain(`Unmapped change: ${file}`);
    expect(selection.suites).toHaveLength(4);
  });

  it.each(["docs/FRONTEND.md", "README.md", "CONTRIBUTING.md", "docs/zh-CN/root/CONTRIBUTING.md"])("selects only documentation gates for %s", (file) => {
    const selection = selectVitestImpact([file], inventory);
    expect(selection).toMatchObject({ fullFallback: false, reasons: [], suites: [], gates: ["docs:check"] });
    expect(selection.commands).toEqual(["npm run docs:check"]);
  });

  it.each(["docs/runbooks/manual-acceptance.md", "docs/zh-CN/runbooks/manual-acceptance.md"])("adds the existing runbook-command check for %s", (file) => {
    const selection = selectVitestImpact([file, "docs/FRONTEND.md"], inventory);
    expect(selection).toMatchObject({ fullFallback: false, suites: [], gates: ["docs:check", "docs:runbook-commands:check"] });
    expect(selection.commands).toEqual(["npm run docs:check", "npm run docs:runbook-commands:check"]);
  });

  it("does not let documentation select suites or hide a mapped code change", () => {
    const selection = selectVitestImpact(["docs/FRONTEND.md", "src/features/example/page.tsx"], inventory);
    expect(selection.fullFallback).toBe(false);
    expect(selection.suites).toHaveLength(4);
    expect(selection.gates).toEqual(["docs:check", "ui:check"]);
    expect(selection.commands.slice(-2)).toEqual(["npm run docs:check", "npm run ui:check"]);
  });

  it("fails an empty change or test selection instead of printing a passing no-op", () => {
    expect(() => selectVitestImpact([], inventory)).toThrow(/empty/i);
    const empty = { files: [], related: {} };
    expect(() => selectVitestImpact(["unknown"], { frontend: empty, server: empty, scripts: empty, bridge: empty })).toThrow(/empty/i);
  });

  it.each([
    ["ops/check-backup.ts", ["scripts"]],
    ["packages/device-bridge/src/client.ts", ["bridge"]],
    ["src/features/example/page.css", ["frontend", "scripts"]],
  ])("includes read-based guards for %s even without import edges", (file, expectedSuites) => {
    const selection = selectVitestImpact([file as string], inventory);

    expect(selection.fullFallback).toBe(false);
    expect(selection.suites.map((suite) => suite.name)).toEqual(expectedSuites);
    for (const suite of selection.suites) expect(suite.files).toEqual([...inventory[suite.name].files].sort());
  });

  it.each(["scripts/check-doc-governance.ts", "scripts/check-ui-standards.ts", "scripts/run-log-analysis-quality-eval.ts", "scripts/check-acceptance-state-models.ts"])("selects related scripts tests, not full coverage, for ordinary script %s", (file) => {
    const mapped = { ...inventory, scripts: { ...inventory.scripts, related: { [file]: ["scripts/run-vitest.test.ts"] } } };
    const selection = selectVitestImpact([file], mapped);
    expect(selection.fullFallback).toBe(false);
    expect(selection.reasons).toEqual([]);
    expect(selection.suites.map((suite) => [suite.name, suite.files])).toEqual([["scripts", ["scripts/run-vitest.test.ts"]]]);
  });

  it.each([
    ["src/features/example/page.tsx", ["ui:check"]],
    ["src/features/example/page.css", ["ui:check"]],
    ["server/modules/contracts/openapi.ts", ["contract:check"]],
    ["server/modules/contracts/dtoSchemas/logs.ts", ["contract:check"]],
    [".github/workflows/ci.yml", ["acceptance:ci"]],
    ["scripts/ci-required-results.ts", ["acceptance:ci"]],
    ["scripts/check-acceptance-ci.ts", ["acceptance:ci"]],
  ] as const)("includes static gates for %s alongside suite commands", (file, gates) => {
    const selection = selectVitestImpact([file], inventory);
    expect(selection.gates).toEqual(gates);
    expect(selection.commands.slice(-gates.length)).toEqual(gates.map((gate) => `npm run ${gate}`));
  });

  it("selects contract validation without suites for the generated OpenAPI artifact", () => {
    const selection = selectVitestImpact(["docs/generated/openapi.json"], inventory);
    expect(selection).toMatchObject({ fullFallback: false, suites: [], gates: ["contract:check"] });
    expect(selection.commands).toEqual(["npm run contract:check"]);
  });

  it("normalizes, sorts and deduplicates paths without accepting paths outside the repo", () => {
    const selection = selectVitestImpact(["./src/features/example/page.tsx", "src\\features\\example\\page.tsx"], inventory);
    expect(selection.changedPaths).toEqual(["src/features/example/page.tsx"]);
    for (const file of ["../outside.ts", "/outside.ts", "C:\\outside.ts", "src/../outside.ts", ""]) {
      expect(() => selectVitestImpact([file], inventory)).toThrow(/invalid/i);
    }
  });

  it("does not miss the view-switch route-list or CSS-only guards from the UI round", () => {
    const routes = selectVitestImpact(["e2e/quality/consistency-routes.ts"], inventory);
    expect(routes.fullFallback).toBe(true);
    expect(routes.suites.find((suite) => suite.name === "scripts")?.files).toContain("scripts/quality-view-switch.test.ts");
    const css = selectVitestImpact(["src/components/ui/view-switch.css"], inventory);
    expect(css.suites.find((suite) => suite.name === "frontend")?.files).toContain("src/components/ui/view-switch.styles.test.ts");
    expect(css.suites.find((suite) => suite.name === "scripts")?.files).toContain("scripts/quality-view-switch.test.ts");
  });
});

describe("native Vitest discovery", () => {
  let root: string;
  const script = fileURLToPath(new URL("./test-impact.ts", import.meta.url));
  const invoke = (...args: string[]) => spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), script, ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" },
  });
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "wiseeff-test-impact-"));
    const write = (file: string, source: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    };
    for (const [config, include] of [
      ["vite.config.ts", "src/**/*.test.ts"], ["vitest.server.config.ts", "server/**/*.test.ts"],
      ["vitest.scripts.config.ts", "scripts/**/*.test.ts"], ["vitest.bridge.config.ts", "packages/**/*.test.ts"],
    ]) write(config, `export default { test: { include: [${JSON.stringify(include)}], globalSetup: ['./never-run.ts'] } };`);
    write("package.json", '{"type":"module"}');
    write("eslint.config.js", `import parser from ${JSON.stringify(createRequire(import.meta.url).resolve("@typescript-eslint/parser"))};
export default [{ files: ["**/*.{ts,tsx}"], languageOptions: { parser }, rules: { "no-unreachable": "error" } }];`);
    for (const [name, include] of [
      ["app", ["src/**/*.ts"]], ["node", ["server/**/*.ts", "scripts/**/*.ts", "*.ts"]],
      ["tests.node", ["server/**/*.ts", "scripts/**/*.ts", "packages/**/*.ts"]],
      ["tests.browser", ["src/**/*.ts", "e2e/**/*.ts"]],
    ]) write(`tsconfig.${name}.json`, JSON.stringify({ compilerOptions: { target: "ES2023", lib: ["ES5"], types: [], skipLibCheck: true, noEmit: true }, include }));
    write("never-run.ts", "throw new Error('Global setup must not run');");
    write("e2e/acceptance/example.spec.ts", "page.goto('/organization');");
    write("src/shared/value.ts", "export const value = 42;");
    write("src/features/example/page.ts", "export { value } from '../../shared/value';");
    for (const [file, source] of [
      ["src/features/example/page.test.ts", "./page"],
      ["server/value.test.ts", "../src/shared/value"],
      ["scripts/value.test.ts", "../src/shared/value"],
      ["packages/example/value.test.ts", "../../src/shared/value"],
    ]) write(file, `import { value } from '${source}'; throw new Error('Tests must not execute: ' + value);`);
    write("src/unrelated.test.ts", "throw new Error('Unrelated test must not execute');");
    write("packages/example/unrelated.test.ts", "throw new Error('Unrelated Bridge test must not execute');");
  });

  it("uses transitive related-test discovery across suites without executing tests or global setup", async () => {
    const selection = await createVitestImpact(["src/shared/value.ts"], root);

    expect(selection.fullFallback, selection.reasons.join("\n")).toBe(false);
    expect(selection.suites.map((suite) => [suite.name, suite.files])).toEqual([
      ["frontend", ["src/features/example/page.test.ts"]], ["server", ["server/value.test.ts"]],
      ["scripts", ["scripts/value.test.ts"]], ["bridge", ["packages/example/value.test.ts"]],
    ]);
    expect(selection.staticCoverage).toMatchObject({ status: "selected", testExecution: "not-run", files: [
      { path: "src/shared/value.ts", lint: { status: "configured" }, typecheck: { status: "configured", project: "tsconfig.app.json" } },
    ] });
    expect(selection.commands[0]).toBe("npm run lint:changed -- src/shared/value.ts");
  });

  it("keeps conservative discovery when coverage fails and executes the emitted static entry point", () => {
    mkdirSync(join(root, "tools"));
    writeFileSync(join(root, "tools/unknown.ts"), "export const value = 1;");
    const unknown = invoke("--json", "src/shared/value.ts", "tools/unknown.ts");
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ fullFallback: true, browser: { fullFallback: true }, staticCoverage: { status: "failed" }, ciStatus: "not-run" });
    writeFileSync(join(root, "src/shared/value.ts"), 'export const value: number = "wrong";');
    const checked = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./check-static-coverage.ts", import.meta.url)), "src/shared/value.ts"], {
      cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" },
    });
    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout).staticCoverage.problems.join("\n")).toContain("TS2322");
  });

  it("selects documentation gates without loading test configurations, including deleted documents", async () => {
    for (const config of ["vite.config.ts", "vitest.server.config.ts", "vitest.scripts.config.ts", "vitest.bridge.config.ts"]) rmSync(join(root, config));
    writeFileSync(join(root, "README.md"), "# Documentation");
    const selection = await createVitestImpact(["README.md", "docs/FRONTEND.md"], root);
    expect(selection).toMatchObject({ fullFallback: false, suites: [], gates: ["docs:check"] });
    const result = invoke("--json", "README.md");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).commands).toEqual(["npm run docs:check"]);
  });

  it("discovers only related tests for an ordinary script even when its name contains quality", async () => {
    writeFileSync(join(root, "scripts/quality-report.ts"), "export const value = 42;");
    writeFileSync(join(root, "scripts/value.test.ts"), "import { value } from './quality-report'; throw new Error('Never execute: ' + value);");
    const selection = await createVitestImpact(["scripts/quality-report.ts"], root);
    expect(selection.fullFallback).toBe(false);
    expect(selection.suites.map((suite) => [suite.name, suite.files])).toEqual([["scripts", ["scripts/value.test.ts"]]]);
  });

  it("emits a runnable runbook gate that reuses the existing command validator", () => {
    const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
    expect(scripts["docs:runbook-commands:check"]).toBe("tsx scripts/check-runbook-commands.ts");
    const directory = join(root, "docs/runbooks");
    mkdirSync(directory, { recursive: true });
    const commands = "npm run rollback:rehearsal -- --notes notes.json\nnpm run capacity:gate -- --k6-summary k6.json --metrics-snapshot metrics.json\nnpm run selfhost:release-gate -- --backup-evidence backup.json\n";
    for (const file of ["release-rollback.md", "manual-acceptance.md"]) writeFileSync(join(directory, file), commands);
    const run = () => spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./check-runbook-commands.ts", import.meta.url))], {
      cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" },
    });
    const valid = run();
    expect(valid.status, valid.stderr).toBe(0);
    writeFileSync(join(directory, "manual-acceptance.md"), commands.replace("--notes notes.json", ""));
    const invalid = run();
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("missing --notes");
  });

  it("prints runnable commands on stderr and parseable JSON on stdout; --json suppresses commands", () => {
    const normal = invoke("src/shared/value.ts");
    expect(normal.status, normal.stderr).toBe(0);
    const selection = JSON.parse(normal.stdout);
    expect(selection.suites.map((suite: { name: string }) => suite.name)).toEqual(["frontend", "server", "scripts", "bridge"]);
    expect(selection.browser).toMatchObject({ fullFallback: true, qualityGrep: ".*", acceptanceSpecs: ["e2e/acceptance/example.spec.ts"] });
    for (const command of selection.commands) expect(normal.stderr).toContain(command);
    const jsonOnly = invoke("--json", "src/shared/value.ts");
    expect(jsonOnly.status, jsonOnly.stderr).toBe(0);
    expect(JSON.parse(jsonOnly.stdout)).toEqual({ ...selection, staticCoverage: { ...selection.staticCoverage, durationMs: expect.any(Number) } });
    expect(jsonOnly.stderr).toBe("");
    for (const args of [[], ["--base", "HEAD", "src/shared/value.ts"], ["--unknown"], ["../outside.ts"], ["--base", "not-a-commit"]]) {
      const result = invoke(...args);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
    }
  });

  it("diff-base input includes committed, staged, unstaged, untracked, deleted and both rename paths", () => {
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture base");
    const base = git("rev-parse", "HEAD");
    const empty = invoke("--base", "HEAD", "--json");
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain("Empty changed-file selection");
    writeFileSync(join(root, "server/value.test.ts"), "export const changed = true;");
    git("add", "server/value.test.ts");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture change");
    git("mv", "src/unrelated.test.ts", "src/renamed.test.ts");
    writeFileSync(join(root, "scripts/value.test.ts"), "export const staged = true;");
    git("add", "scripts/value.test.ts");
    writeFileSync(join(root, "src/shared/value.ts"), "export const value = 43;");
    writeFileSync(join(root, "src/untracked file.ts"), "export const untracked = true;");
    rmSync(join(root, "packages/example/value.test.ts"));
    const result = invoke("--base", base, "--json");

    expect(result.status, result.stderr).toBe(0);
    const selection = JSON.parse(result.stdout);
    expect(selection.changedPaths).toEqual([
      "packages/example/value.test.ts", "scripts/value.test.ts", "server/value.test.ts",
      "src/renamed.test.ts", "src/shared/value.ts", "src/unrelated.test.ts", "src/untracked file.ts",
    ]);
    expect(selection.fullFallback).toBe(true);
    expect(selection.reasons).toContain("Missing or deleted change: packages/example/value.test.ts");
    expect(selection.base).toBe(base);
    expect(selection.staticCoverage.status).toBe("selected");
    expect(selection.staticCoverage.files.find((file: { path: string }) => file.path === "packages/example/value.test.ts")?.typecheck.status).toBe("excluded");
  });

  it("falls back when dependency discovery cannot transform a source file", async () => {
    writeFileSync(join(root, "src/features/example/page.ts"), "export const = 42;");
    const selection = await createVitestImpact(["src/shared/value.ts"], root);
    expect(selection.fullFallback).toBe(true);
    expect(selection.reasons.join("\n")).toContain("Related discovery failed for frontend");
    expect(selection.suites.find((suite) => suite.name === "frontend")?.files).toContain("src/unrelated.test.ts");
    expect(selection.commands).toHaveLength(7);
  });

  it("discovers visited routes in a differently named spec and its called helpers", async () => {
    mkdirSync(join(root, "src/features/log-analysis"), { recursive: true });
    writeFileSync(join(root, "src/features/log-analysis/LogsPage.tsx"), "export const page = true;");
    writeFileSync(join(root, "e2e/acceptance/visit.ts"), "export const visit = (page) => page.goto('/logs');");
    writeFileSync(join(root, "e2e/acceptance/renamed.spec.ts"), "import { visit } from './visit'; page.goto('/knowledge'); visit(page);");

    const selection = await createVitestImpact(["src/features/log-analysis/LogsPage.tsx"], root);
    expect(selection.browser.fullFallback).toBe(false);
    expect(selection.browser.acceptanceSpecs).toEqual(["e2e/acceptance/renamed.spec.ts"]);
    expect(selection.commands).toContain(selection.browser.commands[0]);
    expect(selection.commands).toContain(selection.browser.commands[1]);
  });

  it("resolves runtime templates, helper arguments/defaults, constants and registry nav labels without uncalled helpers", () => {
    writeFileSync(join(root, "src/appConfig.ts"), `export const navigationItems = [{ path: '/parameter-home', label: '我的工作台' }, { path: '/logs', label: '智能分析' }]; export const utilityItems = [];`);
    writeFileSync(join(root, "e2e/acceptance/routes.ts"), "export const HOME = '/parameter-home'; export const ORGANIZATION = '/organization';");
    writeFileSync(join(root, "e2e/acceptance/navigate.ts"), `import { HOME } from './routes';
      export function navigate(page, route = HOME) { return page.goto(route); }
      export function signIn(page, route = HOME) { return navigate(page, route); }
      export function unused(page) { return page.goto('/logs'); }`);
    writeFileSync(join(root, "e2e/acceptance/default.spec.ts"), "import { signIn as login } from './navigate'; login(page);");
    writeFileSync(join(root, "e2e/acceptance/argument.spec.ts"), "import { navigate } from './navigate'; import { ORGANIZATION as target } from './routes'; navigate(page, target);");
    writeFileSync(join(root, "e2e/acceptance/template.spec.ts"), "page.goto(`${runtime.frontendUrl}/logs?logId=${id}`);");
    writeFileSync(join(root, "e2e/acceptance/nav.spec.ts"), `const button = page.getByRole('button', { name: '我的工作台' }); button.click(); page.getByRole('link', { name: /^智能分析$/ }).click();`);
    const discovered = discoverBrowserInventory(root);
    expect(discovered["e2e/acceptance/default.spec.ts"]).toEqual(["/parameter-home"]);
    expect(discovered["e2e/acceptance/argument.spec.ts"]).toEqual(["/organization"]);
    expect(discovered["e2e/acceptance/template.spec.ts"]).toEqual(["/logs"]);
    expect(discovered["e2e/acceptance/nav.spec.ts"]).toEqual(["/logs", "/parameter-home"]);
  });

  it("rejects new unresolved navigation unless explicitly allow-listed with a reason", () => {
    const spec = "e2e/acceptance/dynamic.spec.ts";
    writeFileSync(join(root, spec), "page.goto(destination);");
    expect(() => discoverBrowserInventory(root)).toThrow(/dynamic.spec.ts.*destination/s);
    expect(discoverBrowserInventory(root, { [spec]: "Destination is supplied by an external redirect service" })[spec]).toBeNull();
    expect(() => discoverBrowserInventory(root, { [spec]: "" })).toThrow(/explicit reasoned/);
    expect(() => discoverBrowserInventory(root, { [spec]: "Reason", "absent.spec.ts": "Unused" })).toThrow(/stale/i);
  });
});
