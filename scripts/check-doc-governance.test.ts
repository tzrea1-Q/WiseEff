import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  currentXiaozeLlmInstructionDocs,
  requiredEnvExampleKeys,
  requiredRepositoryDocs,
  validateActivePlans,
  validateBilingualDeveloperDocs,
  validateCurrentXiaozeLlmInstructions,
  validateM6ReleaseRunbookCommands,
  validateEnvExample,
  validateMarkdownLinks,
  validateHistoricalPlanInventory,
  validateNoDuplicatePlanFilenames,
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

  it("ignores superseded status examples inside fenced code blocks", () => {
    const content = [
      "# Current plan",
      "",
      "```markdown",
      "> Status: **Superseded** by a future plan.",
      "```",
      "",
      "## Documentation Impact Matrix",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/current-plan.md", content)).toEqual([]);
  });

  it("exempts the active development roadmap", () => {
    expect(validatePlanDocument("docs/exec-plans/active/development-roadmap.md", "# Roadmap")).toEqual([]);
  });

  it("rejects a superseded plan that remains active", () => {
    const content = [
      "# Replaced implementation plan",
      "",
      "> Status: **Superseded** by the canonical workbench plan.",
      "",
      "## Documentation Impact Matrix",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/replaced-plan.md", content)).toEqual([
      "docs/exec-plans/active/replaced-plan.md declares itself superseded and must move to docs/exec-plans/completed."
    ]);
  });

  it("rejects a Chinese superseded plan that remains active", () => {
    const content = [
      "# 已被替代的实施计划",
      "",
      "> 状态：**已被后续规范计划取代**。",
      "",
      "## 文档影响矩阵",
      "",
      "## 文档更新门禁"
    ].join("\n");

    expect(validatePlanDocument("docs/zh-CN/exec-plans/active/replaced-plan.md", content)).toEqual([
      "docs/zh-CN/exec-plans/active/replaced-plan.md declares itself superseded and must move to docs/zh-CN/exec-plans/completed."
    ]);
  });

  it("allows an active plan to mention a superseded legacy section after its status token", () => {
    const content = [
      "# Active migration plan",
      "",
      "> Status: Active — legacy section superseded; migration remains.",
      "",
      "## Documentation Impact Matrix",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/current-plan.md", content)).toEqual([]);
  });

  it("allows a whole-bold active status to mention a superseded legacy section", () => {
    const content = [
      "# Active migration plan",
      "",
      "> Status: **Active — legacy section superseded; migration remains.**",
      "",
      "## Documentation Impact Matrix",
      "",
      "## Documentation Update Gate"
    ].join("\n");

    expect(validatePlanDocument("docs/exec-plans/active/current-plan.md", content)).toEqual([]);
  });

  it("allows an active Chinese plan to mention a superseded legacy section after its status token", () => {
    const content = [
      "# 进行中的迁移计划",
      "",
      "> 状态：进行中——旧版章节已被后续实现取代；迁移仍在推进。",
      "",
      "## 文档影响矩阵",
      "",
      "## 文档更新门禁"
    ].join("\n");

    expect(validatePlanDocument("docs/zh-CN/exec-plans/active/current-plan.md", content)).toEqual([]);
  });

  it("allows a whole-bold Chinese active status to mention a superseded legacy section", () => {
    const content = [
      "# 进行中的迁移计划",
      "",
      "> 状态：**进行中——旧版章节已被后续实现取代；迁移仍在推进。**",
      "",
      "## 文档影响矩阵",
      "",
      "## 文档更新门禁"
    ].join("\n");

    expect(validatePlanDocument("docs/zh-CN/exec-plans/active/current-plan.md", content)).toEqual([]);
  });

  it("allows an active Chinese plan to supersede an older plan", () => {
    const content = [
      "# 当前实施计划",
      "",
      "> 状态：**进行中**——本计划取代旧版工作台方向。",
      "",
      "## 文档影响矩阵",
      "",
      "## 文档更新门禁"
    ].join("\n");

    expect(validatePlanDocument("docs/zh-CN/exec-plans/active/current-plan.md", content)).toEqual([]);
  });
});

describe("validateActivePlans", () => {
  it("aggregates validation errors from the English and Chinese active plan trees", async () => {
    const root = await createTempRoot();
    await write(
      root,
      "docs/exec-plans/active/current-plan.md",
      "# Current plan\n\n## Documentation Impact Matrix\n\n## Documentation Update Gate\n"
    );
    await write(
      root,
      "docs/zh-CN/exec-plans/active/replaced-plan.md",
      "# 已被替代的计划\n\n> 状态：**已被后续计划取代**。\n\n## 文档影响矩阵\n\n## 文档更新门禁\n"
    );

    await expect(validateActivePlans(root)).resolves.toEqual([
      "docs/zh-CN/exec-plans/active/replaced-plan.md declares itself superseded and must move to docs/zh-CN/exec-plans/completed."
    ]);
  });
});

describe("validateNoDuplicatePlanFilenames", () => {
  it("fails when the same plan filename lives in both active and completed", async () => {
    const root = await createTempRoot();
    await write(root, "docs/exec-plans/active/2026-07-15-dts-hardening-closeout.md", "# Active copy\n");
    await write(root, "docs/exec-plans/completed/2026-07-15-dts-hardening-closeout.md", "# Completed copy\n");
    await write(
      root,
      "docs/zh-CN/exec-plans/active/2026-07-16-parameter-topology-e2e-review-blockers.md",
      "# 活跃副本\n"
    );
    await write(
      root,
      "docs/zh-CN/exec-plans/completed/2026-07-16-parameter-topology-e2e-review-blockers.md",
      "# 已完成副本\n"
    );

    await expect(validateNoDuplicatePlanFilenames(root)).resolves.toEqual([
      "Plan filename 2026-07-15-dts-hardening-closeout.md exists in both docs/exec-plans/active and docs/exec-plans/completed.",
      "Plan filename 2026-07-16-parameter-topology-e2e-review-blockers.md exists in both docs/zh-CN/exec-plans/active and docs/zh-CN/exec-plans/completed."
    ]);
  });

  it("accepts unique filenames and missing plan directories", async () => {
    const root = await createTempRoot();
    await write(root, "docs/exec-plans/active/still-open.md", "# Open\n");
    await write(root, "docs/exec-plans/completed/already-done.md", "# Done\n");

    await expect(validateNoDuplicatePlanFilenames(root)).resolves.toEqual([]);
  });
});

describe("validateHistoricalPlanInventory", () => {
  it("propagates non-ENOENT errors while checking managed active paths", async () => {
    const root = await createTempRoot();
    const inventory = [
      {
        id: "unreadable-active-path",
        disposition: "implemented" as const,
        activePaths: ["not-a-directory/example-plan.md"],
        completedPaths: {
          en: "docs/exec-plans/completed/example-plan.md",
          zh: "docs/zh-CN/exec-plans/completed/example-plan.md"
        }
      }
    ];
    await write(root, "not-a-directory", "not a directory\n");

    await expect(validateHistoricalPlanInventory(root, inventory)).rejects.toMatchObject({
      code: "ENOTDIR"
    });
  });

  it("requires managed historical plans to leave active and declare their completed disposition", async () => {
    const root = await createTempRoot();
    const inventory = [
      {
        id: "example-plan",
        disposition: "implemented-with-superseded-sections" as const,
        activePaths: [
          "docs/exec-plans/active/example-plan.md",
          "docs/zh-CN/exec-plans/active/example-plan.md"
        ],
        completedPaths: {
          en: "docs/exec-plans/completed/example-plan.md",
          zh: "docs/zh-CN/exec-plans/completed/example-plan.md"
        }
      }
    ];
    await write(root, inventory[0].activePaths[0], "# Still active\n");
    await write(root, inventory[0].completedPaths.en, "# Archived without status\n");

    await expect(validateHistoricalPlanInventory(root, inventory)).resolves.toEqual([
      "Managed historical plan example-plan still exists in active: docs/exec-plans/active/example-plan.md.",
      "docs/exec-plans/completed/example-plan.md must declare Historical status: Implemented with superseded sections and archived.",
      "docs/exec-plans/completed/example-plan.md must declare Residual ownership for any remaining work.",
      "Managed historical plan example-plan is missing completed document: docs/zh-CN/exec-plans/completed/example-plan.md."
    ]);
  });

  it("accepts a managed bilingual archive with explicit status and residual ownership", async () => {
    const root = await createTempRoot();
    const inventory = [
      {
        id: "example-plan",
        disposition: "implemented" as const,
        activePaths: ["docs/exec-plans/active/example-plan.md"],
        completedPaths: {
          en: "docs/exec-plans/completed/example-plan.md",
          zh: "docs/zh-CN/exec-plans/completed/example-plan.md"
        }
      }
    ];
    await write(
      root,
      inventory[0].completedPaths.en,
      "> Historical status: **Implemented and archived**\n> Residual ownership: TD-900.\n"
    );
    await write(
      root,
      inventory[0].completedPaths.zh,
      "> 历史状态：**已实施并归档**\n> 余量归属：TD-900。\n"
    );

    await expect(validateHistoricalPlanInventory(root, inventory)).resolves.toEqual([]);
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
    await write(root, ".env.example", "DATABASE_URL=postgres://example\nXIAOZE_LLM_API_BASE_URL=\n");

    const errors = await validateEnvExample(root);

    expect(errors).toContain("Missing required .env.example key: XIAOZE_LLM_MODEL.");
    expect(errors).toContain("Missing required .env.example key: XIAOZE_LLM_API_KEY.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_QUEUE_MODE.");
    expect(errors).toContain("Missing required .env.example key: REDIS_URL.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_QUEUE_CONCURRENCY.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_API_BASE_URL.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_MODEL.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_API_KEY.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_API_TIMEOUT_MS.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_TOKEN_BUDGET.");
    expect(errors).toContain("Missing required .env.example key: LOG_ANALYSIS_DETERMINISTIC.");
    expect(errors.length).toBeGreaterThan(2);
  });

  it("requires the log-analysis LLM env family to be declared even when other keys are present", async () => {
    const root = await createTempRoot();
    const logAnalysisLlmEnvKeys = [
      "LOG_ANALYSIS_API_BASE_URL",
      "LOG_ANALYSIS_MODEL",
      "LOG_ANALYSIS_API_KEY",
      "LOG_ANALYSIS_API_TIMEOUT_MS",
      "LOG_ANALYSIS_TOKEN_BUDGET",
      "LOG_ANALYSIS_DETERMINISTIC"
    ] as const;
    await write(
      root,
      ".env.example",
      requiredEnvExampleKeys
        .filter((key) => !(logAnalysisLlmEnvKeys as readonly string[]).includes(key))
        .map((key) => `${key}=value`)
        .join("\n")
    );

    const errors = await validateEnvExample(root);

    expect(errors).toEqual(
      logAnalysisLlmEnvKeys.map((key) => `Missing required .env.example key: ${key}.`)
    );
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

describe("validateCurrentXiaozeLlmInstructions", () => {
  it("allows a high-level current overview to name the canonical Xiaoze family without enumerating every key", () => {
    expect(
      validateCurrentXiaozeLlmInstructions(
        "docs/README.md",
        "The current Xiaoze provider uses the `XIAOZE_LLM_*` configuration family."
      )
    ).toEqual([]);
  });

  it("rejects a legacy Xiaoze live-configuration instruction outside the explicit migration fallback", () => {
    const content = [
      "# Local development",
      "",
      "Configure `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`.",
      "Fill `AGENT_API_*` when testing the live Xiaoze LLM."
    ].join("\n");

    expect(validateCurrentXiaozeLlmInstructions("docs/developer/local-development.md", content)).toEqual([
      "docs/developer/local-development.md treats legacy Xiaoze LLM key AGENT_API_* as a current instruction outside an explicit canonical-group-absent migration fallback."
    ]);
  });

  it("requires each operator/config document to name the complete canonical Xiaoze group", () => {
    const content = "Set `XIAOZE_LLM_API_BASE_URL` for live Xiaoze behavior.";

    expect(validateCurrentXiaozeLlmInstructions("docs/runbooks/manual-acceptance.md", content)).toEqual([
      "docs/runbooks/manual-acceptance.md is missing canonical Xiaoze LLM key XIAOZE_LLM_MODEL.",
      "docs/runbooks/manual-acceptance.md is missing canonical Xiaoze LLM key XIAOZE_LLM_API_KEY."
    ]);
  });

  it("does not let a fallback heading authorize legacy keys without structured markers", () => {
    const content = [
      "# Environment variables",
      "",
      "Configure `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`.",
      "",
      "## Legacy migration fallback (canonical group absent only)",
      "",
      "Read `AGENT_API_BASE_URL`, `AGENT_API_KEY`, `XIAOZE_MODEL`, then `AGENT_MODEL`."
    ].join("\n");

    expect(validateCurrentXiaozeLlmInstructions("docs/developer/environment-variables.md", content)).toEqual([
      "docs/developer/environment-variables.md treats legacy Xiaoze LLM key AGENT_API_BASE_URL as a current instruction outside an explicit canonical-group-absent migration fallback.",
      "docs/developer/environment-variables.md treats legacy Xiaoze LLM key AGENT_API_KEY as a current instruction outside an explicit canonical-group-absent migration fallback.",
      "docs/developer/environment-variables.md treats legacy Xiaoze LLM key XIAOZE_MODEL as a current instruction outside an explicit canonical-group-absent migration fallback.",
      "docs/developer/environment-variables.md treats legacy Xiaoze LLM key AGENT_MODEL as a current instruction outside an explicit canonical-group-absent migration fallback."
    ]);
  });

  it("allows legacy keys inside a paired canonical-group-absent migration marker", () => {
    const content = [
      "Configure `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`.",
      "<!-- xiaoze-llm-legacy-fallback:start -->",
      "Read `AGENT_API_BASE_URL`, `AGENT_API_KEY`, `XIAOZE_MODEL`, then `AGENT_MODEL`.",
      "<!-- xiaoze-llm-legacy-fallback:end -->"
    ].join("\n");

    expect(validateCurrentXiaozeLlmInstructions("docs/developer/environment-variables.md", content)).toEqual([]);
  });

  it("rejects an unclosed legacy fallback marker", () => {
    const content = [
      "Configure `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`.",
      "<!-- xiaoze-llm-legacy-fallback:start -->",
      "Read `AGENT_API_BASE_URL` during migration."
    ].join("\n");

    expect(validateCurrentXiaozeLlmInstructions("docs/developer/environment-variables.md", content)).toEqual([
      "docs/developer/environment-variables.md has an unclosed Xiaoze LLM legacy fallback marker."
    ]);
  });

  it("rejects nested and unmatched legacy fallback markers", () => {
    const content = [
      "Configure `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`.",
      "<!-- xiaoze-llm-legacy-fallback:start -->",
      "<!-- xiaoze-llm-legacy-fallback:start -->",
      "Read `AGENT_API_BASE_URL` during migration.",
      "<!-- xiaoze-llm-legacy-fallback:end -->",
      "<!-- xiaoze-llm-legacy-fallback:end -->"
    ].join("\n");

    expect(validateCurrentXiaozeLlmInstructions("docs/developer/environment-variables.md", content)).toEqual([
      "docs/developer/environment-variables.md has nested Xiaoze LLM legacy fallback markers.",
      "docs/developer/environment-variables.md has an unmatched Xiaoze LLM legacy fallback end marker."
    ]);
  });

  it("rejects legacy fallback markers outside the English and Chinese environment guides", () => {
    const content = [
      "The current Xiaoze provider uses the `XIAOZE_LLM_*` family.",
      "<!-- xiaoze-llm-legacy-fallback:start -->",
      "Read `AGENT_API_BASE_URL` during migration.",
      "<!-- xiaoze-llm-legacy-fallback:end -->"
    ].join("\n");

    expect(validateCurrentXiaozeLlmInstructions("docs/README.md", content)).toEqual([
      "docs/README.md may not declare a Xiaoze LLM legacy fallback block; only the English and Chinese environment-variable guides may contain one.",
      "docs/README.md treats legacy Xiaoze LLM key AGENT_API_BASE_URL as a current instruction outside an explicit canonical-group-absent migration fallback."
    ]);
  });

  it("governs every current normative Xiaoze surface and its available language companion", () => {
    expect(currentXiaozeLlmInstructionDocs).toEqual(
      expect.arrayContaining([
        "ARCHITECTURE.md",
        "docs/zh-CN/root/ARCHITECTURE.md",
        "docs/QUALITY_SCORE.md",
        "docs/zh-CN/QUALITY_SCORE.md",
        "docs/README.md",
        "docs/zh-CN/README.md",
        "docs/SECURITY.md",
        "docs/zh-CN/SECURITY.md",
        "docs/design-docs/security-governance.md",
        "docs/zh-CN/design-docs/security-governance.md",
        "docs/design-docs/testing-strategy.md",
        "docs/zh-CN/design-docs/testing-strategy.md",
        "docs/developer/verification-matrix.md",
        "docs/zh-CN/developer/verification-matrix.md",
        "docs/exec-plans/active/2026-08-18-self-hosted-setup-wizard.md",
        "docs/zh-CN/exec-plans/active/2026-08-18-self-hosted-setup-wizard.md",
        "docs/references/pi-agent-provider-evidence.md",
        "docs/design-docs/2026-08-12-knowledge-base-design.md",
        "docs/zh-CN/design-docs/2026-08-12-knowledge-base-design.md"
      ])
    );
    expect(currentXiaozeLlmInstructionDocs).not.toContain(
      "docs/exec-plans/active/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md"
    );
    expect(currentXiaozeLlmInstructionDocs).not.toContain(
      "docs/design-docs/2026-06-26-xiaoze-sole-agent-cleanup-design.md"
    );
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

describe("validateBilingualDeveloperDocs", () => {
  it("reports missing required companion documents", async () => {
    const root = await createTempRoot();
    await write(root, "AGENTS.md", "# Agents\n\n[中文](docs/zh-CN/root/AGENTS.md)\n");

    const errors = await validateBilingualDeveloperDocs(root);

    expect(errors).toContain("Missing Chinese developer-facing doc: docs/zh-CN/root/AGENTS.md.");
  });

  it("requires reciprocal language links", async () => {
    const root = await createTempRoot();
    await write(root, "AGENTS.md", "# Agents\n\n[中文](docs/zh-CN/root/AGENTS.md)\n");
    await write(root, "docs/zh-CN/root/AGENTS.md", "# Agent 指南\n");

    const errors = await validateBilingualDeveloperDocs(root);

    expect(errors).toContain("docs/zh-CN/root/AGENTS.md is missing a language link to AGENTS.md.");
  });

  it("rejects Chinese prose in the English side of a developer-facing pair", async () => {
    const root = await createTempRoot();
    await write(root, "AGENTS.md", "# Agent 指南\n\n[Chinese version](docs/zh-CN/root/AGENTS.md)\n");
    await write(root, "docs/zh-CN/root/AGENTS.md", "# Agent 指南\n\n[英文版](../../../AGENTS.md)\n");

    const errors = await validateBilingualDeveloperDocs(root);

    expect(errors).toContain("AGENTS.md contains Chinese prose; keep developer-facing languages in separate linked files.");
  });

  it("rejects mojibake in the Chinese side of a developer-facing pair", async () => {
    const root = await createTempRoot();
    await write(root, "AGENTS.md", "# Agent Guide\n\n[Chinese](docs/zh-CN/root/AGENTS.md)\n");
    await write(root, "docs/zh-CN/root/AGENTS.md", "# \u951b\u5821\n\n[English](../../../AGENTS.md)\n");

    const errors = await validateBilingualDeveloperDocs(root);

    expect(errors).toContain("docs/zh-CN/root/AGENTS.md appears to contain mojibake or placeholder question marks.");
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
