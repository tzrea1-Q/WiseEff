export type BrowserAcceptanceMode = "local-non-hdc" | "target-non-hdc" | "full-pilot";
export type BrowserAcceptanceStatus = "passed" | "failed" | "skipped";
export type BrowserAcceptanceOverallStatus = "passed" | "failed";
export type BrowserAcceptancePilotOutcome = "pilot_ready" | "non_hdc_local" | "blocked" | "unknown";
export type BrowserAcceptanceHdcStatus = "ready" | "skipped" | "absent" | "unknown";

export type BrowserAcceptanceWorkflowEvidence = {
  id?: string;
  name: string;
  status: BrowserAcceptanceStatus;
  notes?: string;
  artifacts?: string[];
};

export type BrowserAcceptanceEvidenceInput = {
  date?: string;
  metadata: {
    branch: string;
    commit: string;
    dirty: boolean;
  };
  mode: BrowserAcceptanceMode;
  status: BrowserAcceptanceOverallStatus;
  preflight: {
    status: BrowserAcceptanceStatus;
    outcome?: BrowserAcceptancePilotOutcome;
    hdc?: BrowserAcceptanceHdcStatus;
    artifactPath?: string;
    detail?: string;
  };
  playwright: {
    status: BrowserAcceptanceStatus;
    artifactPath?: string;
    detail?: string;
  };
  workflows: BrowserAcceptanceWorkflowEvidence[];
  artifactPaths: string[];
  blockers: string[];
};

export function buildBrowserAcceptanceEvidence(input: BrowserAcceptanceEvidenceInput) {
  const preflightOutcome = input.preflight.outcome ?? "unknown";
  const hdc = input.preflight.hdc ?? "unknown";
  const workflowRows =
    input.workflows.length > 0
      ? input.workflows.map(
          (workflow) =>
            `| ${escapeMarkdownTableCell(workflow.id ?? "")} | ${escapeMarkdownTableCell(workflow.name)} | ${workflow.status} | ${escapeMarkdownTableCell(
              workflow.notes ?? ""
            )} | ${escapeMarkdownTableCell((workflow.artifacts ?? []).join(", "))} |`
        )
      : ["| _none_ | _none_ | skipped | No workflow evidence was reported. |  |"];

  return [
    "## Browser Acceptance Evidence",
    "",
    `- Date: ${input.date ?? new Date().toISOString()}`,
    `- Branch: \`${input.metadata.branch}\``,
    `- Commit: \`${input.metadata.commit}\``,
    `- Dirty worktree: \`${input.metadata.dirty}\``,
    `- Mode: \`${input.mode}\``,
    `- Status: \`${input.status}\``,
    "",
    "### Preflight Result",
    "",
    `- Status: \`${input.preflight.status}\``,
    `- Outcome: \`${preflightOutcome}\``,
    `- HDC: \`${hdc}\``,
    `- Evidence: ${input.preflight.artifactPath ?? "_none_"}`,
    `- Detail: ${input.preflight.detail ?? "_none_"}`,
    "",
    "### Playwright Result",
    "",
    `- Status: \`${input.playwright.status}\``,
    `- Evidence: ${input.playwright.artifactPath ?? "_none_"}`,
    `- Detail: ${input.playwright.detail ?? "_none_"}`,
    "",
    "### Workflow Table",
    "",
    "| ID | Workflow | Status | Notes | Artifacts |",
    "| --- | --- | --- | --- | --- |",
    ...workflowRows,
    "",
    "### Artifact Paths",
    "",
    ...(input.artifactPaths.length > 0 ? input.artifactPaths.map((artifactPath) => `- ${artifactPath}`) : ["- _none_"]),
    "",
    "### Blockers",
    "",
    ...(input.blockers.length > 0 ? input.blockers.map((blocker) => `- ${blocker}`) : ["- _none_"]),
    ""
  ].join("\n");
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}
