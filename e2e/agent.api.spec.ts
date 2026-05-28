import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";

const databaseUrl = process.env.DATABASE_URL;

function buildNpmRunCommand(script: string, platform = process.platform) {
  return platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
    : { command: "npm", args: ["run", script] };
}

function formatSpawnFailure(script: string, result: { status: number | null; stdout?: unknown; stderr?: unknown; error?: { message?: string; code?: string } | null }) {
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const errorDetails = result.error ? `\nchild_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd() : "";

  return [
    `npm run ${script} failed with exit code ${result.status}.`,
    stdout,
    stderr,
    errorDetails
  ].filter(Boolean).join("\n");
}

function runNpmScript(script: string) {
  const invocation = buildNpmRunCommand(script);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(formatSpawnFailure(script, result));
  }
}

test("buildNpmRunCommand uses cmd.exe on Windows", () => {
  expect(buildNpmRunCommand("db:migrate", "win32")).toEqual({
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npm run db:migrate"]
  });
  expect(buildNpmRunCommand("db:migrate", "linux")).toEqual({
    command: "npm",
    args: ["run", "db:migrate"]
  });
});

test("formatSpawnFailure includes child process error details", () => {
  expect(
    formatSpawnFailure("db:migrate", {
      status: null,
      stdout: undefined,
      stderr: undefined,
      error: { code: "EINVAL", message: "spawnSync npm.cmd EINVAL" }
    })
  ).toContain("child_process error: EINVAL spawnSync npm.cmd EINVAL");
});

test.beforeAll(() => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the M4 Agent API E2E smoke.");
  }

  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
});

test("api-mode WiseAgent can summarize and request approval", async ({ page }) => {
  await page.goto("/parameters");
  await page.getByRole("button", { name: "打开 WiseAgent" }).click();
  const agentPanel = page.locator(".agent-panel");
  await expect(agentPanel).toBeVisible();

  await agentPanel.locator(".agent-actions .requires-confirm").click();

  const approvalDialog = page.getByRole("alertdialog", { name: "Create parameter draft" });
  await expect(approvalDialog).toBeVisible({ timeout: 20_000 });
  await expect(approvalDialog).toContainText("Create parameter draft");
  await expect(approvalDialog).toContainText(/Approval is required/i);
  await expect(agentPanel.getByText(/%/)).toBeVisible();
});
