import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  CI_SMOKE_TAG,
  countCiSmokeTags,
  evaluateAcceptanceLocalNonHdcBudget,
  evaluateAcceptanceCiConfiguration,
  evaluateImmutableAcceptanceUpload,
  evaluateL1CiWorkflow,
  findAcceptanceEnvironmentHelperLoads,
  findForbiddenAcceptanceDotenvImports,
  findForbiddenPlaywrightImports,
  readAcceptanceConfigurationSources,
  readAcceptanceEnvironmentSources,
  requiredAcceptanceCiArtifactPaths,
  requiredAcceptanceCiScripts,
  requiredAcceptanceCiWorkflowTokens
} from "./check-acceptance-ci";
import { l1CommandIds } from "./ci-required-results";

const compliantWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

const compliantScripts = {
  ...Object.fromEntries(requiredAcceptanceCiScripts.map((script) => [script, "ok"])),
  "acceptance:smoke":
    "playwright test --config playwright.acceptance.config.ts --grep \"@ci-smoke|warm vite entry graph\" e2e/acceptance/runtime-warmup.spec.ts e2e/acceptance/shell-navigation.acceptance.spec.ts e2e/acceptance/auth-runtime.acceptance.spec.ts e2e/acceptance/parameter-home.acceptance.spec.ts"
};

describe("equivalent fixed L1 scheduling", () => {
  it("maps every original L1 command and prerequisite to four jobs with stable strict aggregates", () => {
    expect(evaluateL1CiWorkflow(readFileSync(".github/workflows/ci.yml", "utf8"))).toEqual({ status: "passed", errors: [] });
  });
  it.each(["build", "docs", "ui", "lint", "metadata", "catalog", "contract", "bridge_package", "logs"])("rejects removal of the original %s command", (id) => {
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const job = workflow.jobs[id === "docs" ? "l1-server" : "l1-static"];
    job.steps = job.steps.filter((step: { id: string }) => step.id !== id);
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it("runs the complete documentation check after vector setup and before backend tests", () => {
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const docsJobs = Object.entries(workflow.jobs).filter(([, job]) => (job as { steps: { id?: string }[] }).steps.some((step) => step.id === "docs"));
    expect(docsJobs.map(([id]) => id)).toEqual(["l1-server"]);
    const job = workflow.jobs["l1-server"];
    const ids = job.steps.map((step: { id: string }) => step.id);
    expect(ids.indexOf("docs")).toBeGreaterThan(ids.indexOf("vector"));
    expect(ids.indexOf("docs")).toBeLessThan(ids.indexOf("server"));
    expect(job.steps.find((step: { id: string }) => step.id === "docs").run).toBe("npm run docs:check");
  });
  it.each(["service", "connection", "static"])("rejects documentation schema validation losing its PG prerequisite: %s", (mutation) => {
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const job = Object.values(workflow.jobs).find((value) => (value as { steps: { id?: string }[] }).steps.some((step) => step.id === "docs")) as { services?: unknown; env?: Record<string, string>; steps: { id: string }[] };
    if (mutation === "service") delete job.services;
    if (mutation === "connection" && job.env) delete job.env.DATABASE_URL;
    if (mutation === "static") {
      const docs = job.steps.find((step) => step.id === "docs");
      job.steps = job.steps.filter((step) => step.id !== "docs");
      workflow.jobs["l1-static"].steps.splice(6, 0, docs);
    }
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it.each(["l1-scripts", "l1-server"])("requires PG, DTS and receipt safety in %s", (id) => {
    const source = readFileSync(".github/workflows/ci.yml", "utf8");
    for (const mutation of ["database", "toolchain", "advisory", "receipt", "vector"]) {
      const workflow = YAML.parse(source);
      const job = workflow.jobs[id];
      if (mutation === "database") delete job.services;
      if (mutation === "toolchain") job.steps.find((step: { id: string }) => step.id === "toolchain").uses = "echo skipped";
      if (mutation === "advisory") job.steps.find((step: { id: string }) => step.id === "install")["continue-on-error"] = true;
      if (mutation === "receipt") job.outputs.receipt = "";
      if (mutation === "vector") job.steps.find((step: { id: string }) => step.id === "vector").run += "\ntrue";
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    }
  });
  it("keeps the backend suite on the job's own loopback database", () => {
    const source = readFileSync(".github/workflows/ci.yml", "utf8");
    const forbidden = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";
    const compliant = YAML.parse(source);
    expect(compliant.jobs["l1-server"].env.DATABASE_URL).not.toBe(forbidden);
    expect(compliant.jobs["l1-server"].services.postgres.env.POSTGRES_DB).not.toBe("wiseeff");

    type MutableJob = {
      env?: Record<string, string>;
      services?: { postgres?: { env?: Record<string, string> } };
      steps: Array<{ id?: string; env?: Record<string, string> }>;
    };
    const rejected = (mutate: (job: MutableJob) => void) => {
      const workflow = YAML.parse(source) as { jobs: Record<string, MutableJob> };
      mutate(workflow.jobs["l1-server"]!);
      const result = evaluateL1CiWorkflow(YAML.stringify(workflow));
      expect(result.status).toBe("failed");
      return result.errors.join(" ");
    };
    const backendDatabase = "must be the job's own loopback:5432 service database";

    expect(rejected((job) => { job.env!.DATABASE_URL = forbidden; })).toContain(`job DATABASE_URL ${backendDatabase}`);
    expect(rejected((job) => { job.env!.TEST_DATABASE_URL = forbidden; }))
      .toContain(`job TEST_DATABASE_URL ${backendDatabase}`);
    expect(rejected((job) => {
      job.steps.find((step) => step.id === "server")!.env = { TEST_DATABASE_URL: forbidden };
    })).toContain(`server step TEST_DATABASE_URL ${backendDatabase}`);
    expect(rejected((job) => {
      job.env!.DATABASE_URL = "postgres://wiseeff:wiseeff@db.internal:5432/wiseeff_l1_server";
    })).toContain(backendDatabase);
    expect(rejected((job) => {
      job.env!.DATABASE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5999/wiseeff_l1_server";
    })).toContain(backendDatabase);
    // node-postgres honours these overrides while `new URL()` does not, so a URL with a
    // query string or a second path segment must never certify as job-owned.
    expect(rejected((job) => {
      job.env!.DATABASE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_l1_server?port=5999";
    })).toContain(backendDatabase);
    expect(rejected((job) => {
      job.env!.DATABASE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_l1_server?host=shared.internal";
    })).toContain(backendDatabase);
    expect(rejected((job) => {
      job.env!.DATABASE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_l1_server/extra";
    })).toContain(backendDatabase);
    // `new URL()` trims a padded scalar; node-postgres does not.
    expect(rejected((job) => {
      job.env!.DATABASE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_l1_server ";
    })).toContain(backendDatabase);
    expect(rejected((job) => { delete job.env!.DATABASE_URL; })).toContain("must define the DATABASE_URL");
    expect(rejected((job) => {
      job.services!.postgres!.env!.POSTGRES_DB = "wiseeff_somewhere_else";
    })).toContain(backendDatabase);
    expect(rejected((job) => { job.services!.postgres!.env!.POSTGRES_DB = "wiseeff"; })).toContain(backendDatabase);
    expect(rejected((job) => { delete job.services; })).toContain("must create the database its backend suite runs against");
  });
  it.each(["build-and-test", "required"])("rejects skip, missing needs, altered source identity and npm installation in %s", (id) => {
    const source = readFileSync(".github/workflows/ci.yml", "utf8");
    for (const mutation of ["condition", "needs", "install", "identity"]) {
      const workflow = YAML.parse(source);
      if (mutation === "condition") workflow.jobs[id].if = "success()";
      if (mutation === "needs") workflow.jobs[id].needs.pop();
      if (mutation === "install") workflow.jobs[id].steps.push({ run: "npm ci" });
      if (mutation === "identity") workflow.env.EFF_HEAD_SHA = "${{ github.sha }}";
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    }
  });
  it.each(["missing", "extra", "wrong-source", "raw-context"])("rejects invalid L1 receipt projection: %s", (mutation) => {
    const workflow = YAML.parse(compliantWorkflow);
    const receipt = workflow.jobs["l1-server"].steps.find((step: { id: string }) => step.id === "receipt");
    const expression = (id: string) => "${{ toJSON(steps." + id + ") }}";
    const projection = String(receipt.env.EFF_STEPS).trim();
    if (mutation === "missing") receipt.env.EFF_STEPS = projection.replace('"docs":' + expression("docs") + ", ", "");
    if (mutation === "extra") receipt.env.EFF_STEPS = projection.replace(/}$/, ', "unexpected":' + expression("server") + "}");
    if (mutation === "wrong-source") receipt.env.EFF_STEPS = projection.replace('"docs":' + expression("docs"), '"docs":' + expression("vector"));
    if (mutation === "raw-context") receipt.env.EFF_STEPS = "${{toJSON(steps)}}";
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it("projects every fixed L1 step from its same-named GitHub step context", () => {
    const workflow = YAML.parse(compliantWorkflow);
    const expression = (id: string) => "${{ toJSON(steps." + id + ") }}";
    for (const [jobId, commandIds] of Object.entries(l1CommandIds)) {
      const receipt = workflow.jobs[jobId].steps.find((step: { id: string }) => step.id === "receipt");
      const expected = "{" + commandIds.map((id) => '"' + id + '":' + expression(id)).join(", ") + "}";
      expect(String(receipt.env.EFF_STEPS).trim()).toBe(expected);
    }
  });
  it.each([
    ["l1-frontend", "shadow_frontend", "frontend"],
    ["l1-scripts", "shadow_scripts", "scripts"],
    ["l1-scripts", "shadow_bridge", "bridge"],
    ["l1-server", "shadow_server", "server"],
  ] as const)("rejects %s/%s shadow producer mapping drift", (jobId, output, stepId) => {
    const source = compliantWorkflow;
    for (const mutation of ["missing", "wrong", "hardcoded", "extra"]) {
      const workflow = YAML.parse(source);
      const outputs = workflow.jobs[jobId].outputs;
      if (mutation === "missing") delete outputs[output];
      if (mutation === "wrong") {
        const wrongStep = stepId === "bridge" ? "scripts" : stepId === "server" ? "frontend" : "server";
        outputs[output] = "${{ steps." + wrongStep + ".outputs.shadow }}";
      }
      if (mutation === "hardcoded") outputs[output] = "shadow";
      if (mutation === "extra") outputs.unmapped = "${{ steps." + stepId + ".outputs.shadow }}";
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    }
  });
  it.each(["detect", "l1-static", "l1-frontend", "l1-scripts", "l1-server"])("rejects EFF_NEEDS projection drift for %s", (field) => {
    const workflow = YAML.parse(compliantWorkflow);
    const results = workflow.jobs["build-and-test"].steps.find((step: { id: string }) => step.id === "results");
    const projection = String(results.env.EFF_NEEDS);
    results.env.EFF_NEEDS = projection.replace(`"${field}"`, `"${field}-unmapped"`);
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it.each(["detect", "l1-frontend", "l1-scripts", "l1-server"])("rejects EFF_SHADOW projection drift for %s", (field) => {
    const workflow = YAML.parse(compliantWorkflow);
    const results = workflow.jobs["build-and-test"].steps.find((step: { id: string }) => step.id === "results");
    const projection = String(results.env.EFF_SHADOW);
    results.env.EFF_SHADOW = projection.replace(`"${field}"`, `"${field}-unmapped"`);
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  const projectionExpression = (path: string) => "${{ toJSON(" + path + ") }}";
  const projectionMutationCases = [
    { projection: "EFF_NEEDS", key: "detect", expressionPath: "needs.detect", wrongPath: "needs.l1-server", extraPath: "needs.detect" },
    ...["l1-static", "l1-frontend", "l1-scripts", "l1-server"].flatMap((job) => [
      { projection: "EFF_NEEDS", key: `${job}.result`, expressionPath: `needs.${job}.result`, wrongPath: "needs.detect.result", extraPath: `needs.${job}.outputs.receipt` },
      { projection: "EFF_NEEDS", key: `${job}.receipt`, expressionPath: `needs.${job}.outputs.receipt`, wrongPath: job === "l1-server" ? "needs.l1-static.outputs.receipt" : "needs.l1-server.outputs.receipt", extraPath: `needs.${job}.result` },
    ]),
    { projection: "EFF_SHADOW", key: "detect", expressionPath: "needs.detect", wrongPath: "needs.l1-server", extraPath: "needs.detect" },
    { projection: "EFF_SHADOW", key: "l1-frontend.result", expressionPath: "needs.l1-frontend.result", wrongPath: "needs.detect.result", extraPath: "needs.l1-frontend.outputs.shadow_frontend" },
    { projection: "EFF_SHADOW", key: "l1-frontend.shadow_frontend", expressionPath: "needs.l1-frontend.outputs.shadow_frontend", wrongPath: "needs.l1-server.outputs.shadow_server", extraPath: "needs.l1-frontend.result" },
    { projection: "EFF_SHADOW", key: "l1-scripts.result", expressionPath: "needs.l1-scripts.result", wrongPath: "needs.detect.result", extraPath: "needs.l1-scripts.outputs.shadow_scripts" },
    { projection: "EFF_SHADOW", key: "l1-scripts.shadow_scripts", expressionPath: "needs.l1-scripts.outputs.shadow_scripts", wrongPath: "needs.l1-server.outputs.shadow_server", extraPath: "needs.l1-scripts.result" },
    { projection: "EFF_SHADOW", key: "l1-scripts.shadow_bridge", expressionPath: "needs.l1-scripts.outputs.shadow_bridge", wrongPath: "needs.l1-frontend.outputs.shadow_frontend", extraPath: "needs.l1-scripts.result" },
    { projection: "EFF_SHADOW", key: "l1-server.result", expressionPath: "needs.l1-server.result", wrongPath: "needs.detect.result", extraPath: "needs.l1-server.outputs.shadow_server" },
    { projection: "EFF_SHADOW", key: "l1-server.shadow_server", expressionPath: "needs.l1-server.outputs.shadow_server", wrongPath: "needs.l1-frontend.outputs.shadow_frontend", extraPath: "needs.l1-server.result" },
  ] as const;
  const projectionMutations = ["missing", "extra", "wrong", "hardcoded"] as const;
  const applyProjectionMutation = (projection: string, descriptor: (typeof projectionMutationCases)[number], mutation: (typeof projectionMutations)[number]) => {
    const expression = projectionExpression(descriptor.expressionPath);
    const target = descriptor.key.includes(".") ? `"${descriptor.key.split(".")[1]}":${expression}` : `"${descriptor.key}":${expression}`;
    if (mutation === "missing") return projection.replace(target, "");
    if (mutation === "wrong") return projection.replace(target, target.replace(expression, projectionExpression(descriptor.wrongPath)));
    if (mutation === "hardcoded") return projection.replace(target, target.replace(expression, '"success"'));
    return projection.replace(target, `${target},"unmapped":${projectionExpression(descriptor.extraPath)}`);
  };
  it.each(projectionMutationCases.flatMap((descriptor) => projectionMutations.map((mutation) => [descriptor, mutation] as const)))
    ("rejects %s %s projection mutation for %s", (descriptor, mutation) => {
      const workflow = YAML.parse(compliantWorkflow);
      const results = workflow.jobs["build-and-test"].steps.find((step: { id: string }) => step.id === "results");
      results.env[descriptor.projection] = applyProjectionMutation(String(results.env[descriptor.projection]), descriptor, mutation);
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    });
  it("rejects whitespace inserted into a projected JSON key", () => {
    const workflow = YAML.parse(compliantWorkflow);
    const receipt = workflow.jobs["l1-server"].steps.find((step: { id: string }) => step.id === "receipt");
    receipt.env.EFF_STEPS = String(receipt.env.EFF_STEPS).replace('"docs"', '"do cs"');
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it("retains all events, modes, full acceptance labeling and PR-only cancellation", () => {
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.pull_request.types).toEqual(["opened", "synchronize", "reopened", "labeled"]);
    expect(workflow.on.schedule).toEqual([{ cron: "30 18 * * *" }]);
    expect(workflow.on.workflow_dispatch.inputs.acceptance_mode.options).toEqual(["local-non-hdc", "target-non-hdc", "full-pilot", "minimal-upgrade"]);
    expect(workflow.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
    expect(workflow.jobs.detect.steps.find((step: { id: string }) => step.id === "paths").run).toContain('echo "run_l2=true"');
  });
});

describe("M5.12 acceptance CI configuration", () => {
  it("keeps the L2 platform budget strictly above bounded prelude, Gate0 owner, and always finalization", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const budget = evaluateAcceptanceLocalNonHdcBudget(workflow);

    expect(budget).toMatchObject({
      status: "passed",
      jobTimeoutMinutes: 155,
      platformOverheadMinutes: 5,
      preGate0BudgetMinutes: 72,
      gate0OwnerMinutes: 60,
      artifactSafetyMinutes: 5,
      artifactUploadMinutes: 5,
      requiredExclusiveFloorMinutes: 151,
      missingStepTimeouts: [],
    });
    expect(budget.jobTimeoutMinutes).toBeGreaterThan(budget.requiredExclusiveFloorMinutes);

    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace("    timeout-minutes: 155", "    timeout-minutes: 151"),
    ).status).toBe("failed");
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Owned visual and browser acceptance Gate 0",
        "      - name: Unbounded added prerequisite\n        run: npm run surprise\n\n      - name: Owned visual and browser acceptance Gate 0",
      ),
    )).toMatchObject({ status: "failed", missingStepTimeouts: ["Unbounded added prerequisite"] });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - name: Unbounded added finalizer\n        if: always()\n        run: npm run surprise:finalize\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({ status: "failed", missingStepTimeouts: ["Unbounded added finalizer"] });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - name: Bounded added finalizer\n        if: always()\n        timeout-minutes: 4\n        run: npm run surprise:finalize\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({
      status: "failed",
      requiredExclusiveFloorMinutes: 155,
      missingStepTimeouts: [],
    });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - if: always()\n        name: If-first unbounded finalizer\n        run: npm run surprise:if-first\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({
      status: "failed",
      missingStepTimeouts: ["If-first unbounded finalizer"],
    });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - if: always()\n        name: If-first bounded finalizer\n        timeout-minutes: 4\n        run: npm run surprise:if-first\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({
      status: "failed",
      requiredExclusiveFloorMinutes: 155,
      missingStepTimeouts: [],
    });
  });

  it("routes every formerly dotenv-backed acceptance spec through the owned-runtime-aware helper", () => {
    const sources = readAcceptanceEnvironmentSources();

    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    const helperLoads = findAcceptanceEnvironmentHelperLoads(sources);
    expect(helperLoads).toHaveLength(40);
    expect(helperLoads).toContain("e2e/acceptance/canonical-value-workflow.acceptance.spec.ts");
    expect(helperLoads).toContain("e2e/acceptance/parameter-catalog-policy-usage.acceptance.spec.ts");
  });

  it("routes both Playwright acceptance configs through the same owned-runtime-aware helper", () => {
    const sources = readAcceptanceConfigurationSources();

    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    expect(findAcceptanceEnvironmentHelperLoads(sources)).toHaveLength(2);
  });

  it("requires layered job ids, smoke, and a single quality-run token", () => {
    expect(requiredAcceptanceCiScripts).toEqual([
      "acceptance:ci",
      "acceptance:browser",
      "acceptance:artifacts:check",
      "acceptance:artifacts:finalize",
      "acceptance:gate0",
      "acceptance:models",
      "acceptance:quality",
      "acceptance:quality-run",
      "acceptance:smoke",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);
    expect(requiredAcceptanceCiWorkflowTokens).toEqual(
      expect.arrayContaining([
        "name: Detect changed paths",
        "name: Merge bar",
        "acceptance-smoke:",
        "acceptance-local-non-hdc:",
        "full-acceptance",
        "cancel-in-progress",
        "Acceptance CI metadata (L1)",
        "./.github/actions/setup-dts-toolchain",
        "npm run acceptance:quality-run",
        "npm run acceptance:smoke",
        "npm run acceptance:gate0"
      ])
    );
    expect(requiredAcceptanceCiWorkflowTokens).not.toContain("npm run acceptance:a11y");
    expect(requiredAcceptanceCiArtifactPaths).toEqual([
      "playwright-report/acceptance",
      "test-results/acceptance",
      "docs/generated/acceptance-browser-evidence.md",
      "docs/generated/acceptance-operation-evidence.md",
      "docs/generated/acceptance-operation-evidence/index.json",
      "playwright-report/quality",
      "test-results/quality",
      "test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip"
    ]);
  });

  it("passes when the package scripts, workflow layers, and smoke cap are present", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: compliantWorkflow,
      smokeTagCount: 3
    });

    expect(result).toMatchObject({
      status: "passed",
      missingScripts: [],
      missingWorkflowTokens: [],
      missingArtifactPaths: [],
      smokeTagGate: true
    });
  });

  it("fails when CI cannot run local acceptance or archive evidence", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: {
        scripts: {
          "acceptance:browser": "tsx -- scripts/run-browser-acceptance.ts"
        }
      },
      workflowText: `
name: CI
on:
  pull_request:
jobs:
  build-and-test:
    steps:
      - run: npm test
`,
      smokeTagCount: 0
    });

    expect(result.status).toBe("failed");
    expect(result.missingScripts).toEqual([
      "acceptance:ci",
      "acceptance:artifacts:check",
      "acceptance:artifacts:finalize",
      "acceptance:gate0",
      "acceptance:models",
      "acceptance:quality",
      "acceptance:quality-run",
      "acceptance:smoke",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);
    expect(result.missingWorkflowTokens).toEqual(expect.arrayContaining([...requiredAcceptanceCiWorkflowTokens]));
    expect(result.missingArtifactPaths).toEqual(requiredAcceptanceCiArtifactPaths);
    expect(result.smokeTagGate).toBe(false);
  });

  it("rejects uploading the live tree or bypassing immutable finalizer failure", () => {
    expect(evaluateImmutableAcceptanceUpload(compliantWorkflow)).toEqual({ status: "passed", errors: [] });
    expect(evaluateImmutableAcceptanceUpload(
      compliantWorkflow.replace(
        "path: test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip",
        "path: test-results/acceptance-runtime-runs",
      ),
    )).toMatchObject({ status: "failed" });
    expect(evaluateImmutableAcceptanceUpload(
      compliantWorkflow.replace(
        "always() && steps.acceptance_artifact_safety.outcome == 'success'",
        "always()",
      ),
    )).toMatchObject({ status: "failed" });
    expect(evaluateImmutableAcceptanceUpload(
      compliantWorkflow.replace("if-no-files-found: error\n          compression-level: 0", "if-no-files-found: ignore\n          compression-level: 0"),
    )).toMatchObject({ status: "failed" });
  });

  it("rejects extra diagnostic uploads, raw fallbacks, skipped safety and late identity", () => {
    for (const mutate of [
      ...["v3", "unreviewed"].map((ref) => (w: any) => {
        w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.name === "Upload acceptance evidence").uses = `actions/upload-artifact@${ref}`;
      }),
      (w: any) => w.jobs["acceptance-local-non-hdc"].steps.push({ uses: "actions/upload-artifact@v3", with: { path: "." } }),
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.id === "acceptance_diagnostic_upload").with.path = "test-results/**"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.id === "acceptance_diagnostic")["continue-on-error"] = true; },
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.id === "acceptance_diagnostic").shell = "python3 {0}"; },
      (w: any) => { const steps = w.jobs["acceptance-local-non-hdc"].steps; steps.push(...steps.splice(1, 1)); },
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps = w.jobs["acceptance-local-non-hdc"].steps.filter((s: any) => s.id !== "acceptance_diagnostic_fallback"); },
    ]) {
      const workflow = YAML.parse(compliantWorkflow);
      mutate(workflow);
      expect(evaluateImmutableAcceptanceUpload(YAML.stringify(workflow)).status).toBe("failed");
    }
  });

  it("blocks accidental default full-pilot gates on pull requests", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: `${compliantWorkflow}
  dangerous-pr-full-pilot:
    steps:
      - run: npm run acceptance:browser -- --mode full-pilot
`,
      smokeTagCount: 3
    });

    expect(result.status).toBe("failed");
    expect(result.fullPilotDefaultGate).toBe(true);
  });

  it("fails when a spec imports @playwright/test instead of playwright/test", () => {
    expect(
      findForbiddenPlaywrightImports([
        { path: "e2e/acceptance/ok.spec.ts", source: 'import { test } from "playwright/test";\n' }
      ])
    ).toEqual([]);
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: compliantWorkflow,
      smokeTagCount: 3,
      playwrightSources: [
        {
          path: "e2e/acceptance/broken.acceptance.spec.ts",
          source: 'import { test } from "@playwright/test";\n'
        }
      ]
    });
    expect(result.status).toBe("failed");
    expect(result.forbiddenPlaywrightImports).toEqual(["e2e/acceptance/broken.acceptance.spec.ts"]);
  });

  it("skips DTS bootstrap on a warm cache and does not install it in quality", () => {
    const action = readFileSync(".github/actions/setup-dts-toolchain/action.yml", "utf8");
    expect(action).toContain("Use cached DTS toolchain if it already verifies");
    expect(action).toContain("if: steps.dts-warm.outputs.warm != 'true'");
    expect(action).toContain("timeout 180s sudo apt-get update");

    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const qualityJob = workflow.split("\n  acceptance-quality:")[1]?.split("\n  acceptance-smoke:")[0] ?? "";
    expect(qualityJob).toContain("Acceptance quality");
    expect(qualityJob).toContain("timeout-minutes: 35");
    expect(qualityJob).not.toContain("setup-dts-toolchain");
    expect(workflow).toContain("./.github/actions/setup-dts-toolchain");
  });

  it("keeps the isolated minimal upgrade mode out of target acceptance", () => {
    const { jobs } = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    expect(jobs["target-synthetic-acceptance"].if).toContain("inputs.acceptance_mode != 'minimal-upgrade'");
    expect(jobs["minimal-upgrade"].if).toContain("inputs.acceptance_mode == 'minimal-upgrade'");
    expect(JSON.stringify(jobs["minimal-upgrade"])).not.toContain("secrets.");
    const evidenceUpload = jobs["minimal-upgrade"].steps.find((step: { with?: { name?: string } }) =>
      step.with?.name === "minimal-upgrade-terminal-evidence");
    expect(evidenceUpload.with.path).toBe("/tmp/wiseeff-minimal-terminal-*/evidence.zip");
  });

  it("rejects a missing or oversized @ci-smoke set", () => {
    expect(countCiSmokeTags(`test("a", { tag: ["${CI_SMOKE_TAG}"] }, async () => {});`)).toBe(1);
    expect(
      evaluateAcceptanceCiConfiguration({
        packageJson: { scripts: compliantScripts },
        workflowText: compliantWorkflow,
        smokeTagCount: 6
      }).smokeTagGate
    ).toBe(false);
  });
});
