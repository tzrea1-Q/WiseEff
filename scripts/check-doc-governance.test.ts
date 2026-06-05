import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  requiredEnvExampleKeys,
  requiredRepositoryDocs,
  validateM6ReleaseRunbookCommands,
  validateEnvExample,
  validateMarkdownLinks,
  validatePlanDocument,
  validateRequiredRepositoryDocs
} from "./check-doc-governance";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiseeff-docs-check-"));
  tempRoots.push(root);
  return root;
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("validatePlanDocument", () => {
  it("accepts active implementation plans with both required sections", () => {
    const content = [
      "# M5.1 Plan",
      "",
      "## Documentation Impact Matrix",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/m5-1-plan.md", content)).toEqual([]);
  });

  it("rejects active implementation plans missing the Documentation Impact Matrix", () => {
    const content = [
      "# M5.1 Plan",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/m5-1-plan.md", content)).toEqual([
      "docs/exec-plans/active/m5-1-plan.md is missing ## Documentation Impact Matrix."
    ]);
  });

  it("rejects required section text that only appears inside fenced code blocks", () => {
    const content = [
      "# M5.1 Plan",
      "",
      "```markdown",
      "## Documentation Impact Matrix",
      "## Documentation Update Gate",
      "```",
      "",
      "## Task 1"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/m5-1-plan.md", content)).toEqual([
      "docs/exec-plans/active/m5-1-plan.md is missing ## Documentation Impact Matrix.",
      "docs/exec-plans/active/m5-1-plan.md is missing ## Documentation Update Gate."
    ]);
  });

  it("exempts the active development roadmap", () => {
    expect(validatePlanDocument("docs/exec-plans/active/development-roadmap.md", "# Roadmap")).toEqual([]);
  });
});

describe("validateRequiredRepositoryDocs", () => {
  it("reports missing key documentation entry points", async () => {
    const root = await createTempRoot();
    await write(root, "README.md", "# Readme");

    const errors = await validateRequiredRepositoryDocs(root);

    expect(errors).toContain("Missing required documentation file: CONTRIBUTING.md.");
    expect(errors).toContain("Missing required documentation file: docs/developer/README.md.");
    expect(errors).toHaveLength(requiredRepositoryDocs.length - 1);
  });
});

describe("validateEnvExample", () => {
  it("requires .env.example to contain every documented local setup key", async () => {
    const root = await createTempRoot();
    await write(root, ".env.example", "DATABASE_URL=postgres://example\nAGENT_API_BASE_URL=\n");

    const errors = await validateEnvExample(root);

    expect(errors).toContain("Missing required .env.example key: AGENT_MODEL.");
    expect(errors).toContain("Missing required .env.example key: AGENT_API_KEY.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_QUEUE_MODE.");
    expect(errors).toContain("Missing required .env.example key: REDIS_URL.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_QUEUE_CONCURRENCY.");
    expect(errors.length).toBeGreaterThan(2);
  });

  it("accepts an .env.example containing all required keys", async () => {
    const root = await createTempRoot();
    await write(
      root,
      ".env.example",
      requiredEnvExampleKeys.map((key) => `${key}=${key.startsWith("AGENT_") ? "" : "value"}`).join("\n")
    );

    await expect(validateEnvExample(root)).resolves.toEqual([]);
  });
});

describe("validateMarkdownLinks", () => {
  it("reports broken local markdown links", async () => {
    const root = await createTempRoot();
    await write(root, "docs/README.md", "[Missing](missing.md)\n[External](https://example.com)\n");

    await expect(validateMarkdownLinks(root)).resolves.toEqual([
      "Broken local markdown link in docs/README.md: missing.md"
    ]);
  });

  it("accepts existing local markdown links and anchors", async () => {
    const root = await createTempRoot();
    await write(root, "README.md", "[Docs](docs/README.md)\n[Anchor](#local-heading)\n");
    await write(root, "docs/README.md", "# Docs");

    await expect(validateMarkdownLinks(root)).resolves.toEqual([]);
  });
});

describe("validateM6ReleaseRunbookCommands", () => {
  it("requires M6 release runbook commands to include current evidence parameters", () => {
    const content = [
      "npm run rollback:rehearsal -- --environment <label> --smoke-evidence <path>",
      "npm run capacity:gate -- --target-url https://<host>",
      "npm run selfhost:release-gate -- --target-environment <label>"
    ].join("\n");

    expect(validateM6ReleaseRunbookCommands("docs/runbooks/release-rollback.md", content)).toEqual([
      "docs/runbooks/release-rollback.md rollback rehearsal command is missing --notes.",
      "docs/runbooks/release-rollback.md capacity gate command is missing --k6-summary.",
      "docs/runbooks/release-rollback.md capacity gate command is missing --metrics-snapshot.",
      "docs/runbooks/release-rollback.md self-hosted release gate command is missing --backup-evidence."
    ]);
  });
});
