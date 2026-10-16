import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  CI_SMOKE_TAG,
  ciAggregateEventCondition,
  ciCancelInProgressCondition,
  ciSelectedEventCondition,
  countCiSmokeTags,
  evaluateAcceptanceLocalNonHdcBudget,
  evaluateAcceptanceCiConfiguration,
  evaluateImmutableAcceptanceUpload,
  evaluateL1CiWorkflow,
  findAcceptanceEnvironmentHelperLoads,
  findMissingAcceptanceEnvironmentHelperLoads,
  findForbiddenAcceptanceDotenvImports,
  findForbiddenPlaywrightImports,
  readAcceptanceConfigurationSources,
  readAcceptanceEnvironmentSources,
  requiredAcceptanceEnvironmentConfigurationPaths,
  requiredAcceptanceEnvironmentHelperExceptions,
  requiredAcceptanceCiArtifactPaths,
  requiredAcceptanceCiScripts,
  requiredAcceptanceCiWorkflowTokens
} from "./check-acceptance-ci";
import { l1CommandIds } from "./ci-required-results";

const compliantWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const compliantAcceptanceEnvironmentSources = [
  ...readAcceptanceEnvironmentSources(),
  ...readAcceptanceConfigurationSources(),
];

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
    const job = workflow.jobs[id === "docs" ? "l1-server-shards" : "l1-static"];
    job.steps = job.steps.filter((step: { id: string }) => step.id !== id);
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it("runs the complete documentation check after vector setup and before backend tests", () => {
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const docsJobs = Object.entries(workflow.jobs).filter(([, job]) => (job as { steps: { id?: string }[] }).steps.some((step) => step.id === "docs"));
    expect(docsJobs.map(([id]) => id)).toEqual(["l1-server-shards"]);
    const job = workflow.jobs["l1-server-shards"];
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
  it.each(["l1-scripts", "l1-server-shards"])("requires PG, DTS and receipt safety in %s", (id) => {
    const source = readFileSync(".github/workflows/ci.yml", "utf8");
    for (const mutation of ["database", "toolchain", "advisory", "receipt", "vector"]) {
      const workflow = YAML.parse(source);
      const job = workflow.jobs[id];
      if (mutation === "database") delete job.services;
      if (mutation === "toolchain") job.steps.find((step: { id: string }) => step.id === "toolchain").uses = "echo skipped";
      if (mutation === "advisory") job.steps.find((step: { id: string }) => step.id === "install")["continue-on-error"] = true;
      if (mutation === "receipt") job.outputs = { ...job.outputs, receipt: "" };
      if (mutation === "vector") job.steps.find((step: { id: string }) => step.id === "vector").run += "\ntrue";
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    }
  });
  it("keeps the backend suite on the job's own loopback database", () => {
    const source = readFileSync(".github/workflows/ci.yml", "utf8");
    const forbidden = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";
    const compliant = YAML.parse(source);
    expect(compliant.jobs["l1-server-shards"].env.DATABASE_URL).not.toBe(forbidden);
    expect(compliant.jobs["l1-server-shards"].services.postgres.env.POSTGRES_DB).not.toBe("wiseeff");

    type MutableJob = {
      env?: Record<string, string>;
      services?: { postgres?: { env?: Record<string, string> } };
      steps: Array<{ id?: string; env?: Record<string, string> }>;
    };
    const rejected = (mutate: (job: MutableJob) => void) => {
      const workflow = YAML.parse(source) as { jobs: Record<string, MutableJob> };
      mutate(workflow.jobs["l1-server-shards"]!);
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
    const receipt = workflow.jobs["l1-server-shards"].steps.find((step: { id: string }) => step.id === "receipt");
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
      const receipt = workflow.jobs[jobId === "l1-server" ? "l1-server-shards" : jobId].steps.find((step: { id: string }) => step.id === "receipt");
      const expected = "{" + commandIds.map((id) => '"' + id + '":' + expression(id)).join(", ") + "}";
      expect(String(receipt.env.EFF_STEPS).trim()).toBe(expected);
    }
  });
  it.each([
    ["l1-frontend", "shadow_frontend", "frontend"],
    ["l1-scripts", "shadow_scripts", "scripts"],
    ["l1-scripts", "shadow_bridge", "bridge"],
    ["l1-server", "shadow_server", "results"],
  ] as const)("rejects %s/%s shadow producer mapping drift", (jobId, output, stepId) => {
    const source = compliantWorkflow;
    for (const mutation of ["missing", "wrong", "hardcoded", "extra"]) {
      const workflow = YAML.parse(source);
      const outputs = workflow.jobs[jobId].outputs;
      if (mutation === "missing") delete outputs[output];
      if (mutation === "wrong") {
        const wrongStep = stepId === "bridge" ? "scripts" : "server";
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
    const receipt = workflow.jobs["l1-server-shards"].steps.find((step: { id: string }) => step.id === "receipt");
    receipt.env.EFF_STEPS = String(receipt.env.EFF_STEPS).replace('"docs"', '"do cs"');
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it("retains all events, modes, full acceptance labeling and PR-only cancellation", () => {
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.pull_request.types).toEqual(["opened", "synchronize", "reopened", "labeled", "unlabeled"]);
    expect(workflow.on.schedule).toEqual([{ cron: "30 18 * * *" }]);
    expect(workflow.on.workflow_dispatch.inputs.acceptance_mode.options).toEqual(["local-non-hdc", "target-non-hdc", "full-pilot", "minimal-upgrade"]);
    expect(workflow.concurrency["cancel-in-progress"]).toBe(ciCancelInProgressCondition);
    expect(workflow.jobs.detect.steps.find((step: { id: string }) => step.id === "paths").run).toContain('echo "run_l2=true"');
  });

  it.each([
    ["push", "", "", true, false], ["schedule", "", "", true, false], ["workflow_dispatch", "", "", true, false],
    ["pull_request", "synchronize", "", true, true], ["pull_request", "opened", "", true, true],
    ["pull_request", "labeled", "full-acceptance", true, true], ["pull_request", "unlabeled", "full-acceptance", true, true],
    ["pull_request", "labeled", "documentation", false, false], ["pull_request", "unlabeled", "documentation", false, false],
  ])("selects %s/%s/%s without replacing CI for unrelated labels", (eventName, action, label, selected, cancel) => {
    const workflow = YAML.parse(compliantWorkflow);
    const evaluate = (expression: string, context: object) => Function("github", `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(context);
    const github = { event_name: eventName, event: { action, label: { name: label } } };
    expect(evaluate(workflow.jobs.detect.steps[0].env.SELECTED, github)).toBe(selected);
    expect(evaluate(workflow.concurrency["cancel-in-progress"], github)).toBe(cancel);
    expect(workflow.jobs.detect.steps[0].env.SELECTED).toBe(`\${{ ${ciSelectedEventCondition} }}`);
  });

  it.each(["true", "false", ""])("keeps gate naming and failure checks safe for selected=%s", (selected) => {
    const workflow = YAML.parse(compliantWorkflow);
    const evaluate = (expression: string) => Function("needs", "always", `return (${expression});`)({ detect: { outputs: { selected } } }, () => true);
    const name = workflow.jobs.required.name.replace(/\$\{\{(.*?)\}\}/g, (_match: string, expression: string) => evaluate(expression));
    expect(name).toBe(selected === "false" ? "Merge bar (ignored label)" : "Merge bar");
    for (const id of ["build-and-test", "acceptance-quality", "acceptance-local-non-hdc"]) {
      expect(evaluate(workflow.jobs[id].if)).toBe(selected !== "false");
    }
    for (const step of workflow.jobs.required.steps) expect(evaluate(step.if)).toBe(selected !== "false");
  });

  it.each(["predicate", "output", "setup", "aggregate", "name", "event-failure"])("rejects weakened deduplicated selection: %s", (mutation) => {
    const workflow = YAML.parse(compliantWorkflow);
    if (mutation === "predicate") workflow.jobs.detect.steps[0].env.SELECTED = "true";
    if (mutation === "output") workflow.jobs.detect.outputs.selected = "false";
    if (mutation === "setup") delete workflow.jobs.detect.steps[1].if;
    if (mutation === "aggregate") workflow.jobs["build-and-test"].if = "always() && needs.detect.outputs.selected == 'true'";
    if (mutation === "name") workflow.jobs.required.name = "Merge bar (ignored label)";
    if (mutation === "event-failure") workflow.jobs.detect.steps[0]["continue-on-error"] = true;
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
});

describe("D2 backend shards and quality lanes", () => {
  const partitions = [
    ["server", "l1-server-shards", "l1-server", "shard", [1, 2]],
    ["quality", "acceptance-quality-lanes", "acceptance-quality", "lane", ["visual", "consistency-1", "consistency-2", "accessibility"]],
  ] as const;

  it.each(partitions)("retains the exact %s worker and stable aggregate", (kind, workerId, aggregateId, axis, values) => {
    const workflow = YAML.parse(compliantWorkflow);
    expect(evaluateL1CiWorkflow(compliantWorkflow)).toEqual({ status: "passed", errors: [] });
    const worker = workflow.jobs[workerId];
    const aggregate = workflow.jobs[aggregateId];
    expect(worker.strategy).toEqual({ "fail-fast": false, matrix: { [axis]: values } });
    expect(worker.outputs).toBeUndefined();
    expect(worker.env[kind === "server" ? "WISEEFF_CI_SERVER_SHARD" : "WISEEFF_QUALITY_LANE"])
      .toBe(kind === "server" ? "${{ matrix.shard }}/2" : "${{ matrix.lane }}");
    const receipt = worker.steps.find((step: { with?: { path?: string } }) => step.with?.path === "${{ runner.temp }}/wiseeff-ci-shard/receipt.json");
    expect(receipt.with.name).toBe(`wiseeff-ci-${kind}-\${{ github.run_attempt }}-\${{ matrix.${axis} }}`);
    expect(aggregate.needs).toEqual(["detect", workerId]);
    expect(aggregate.steps[2].with).toEqual({ pattern: `wiseeff-ci-${kind}-*-*`, path: "${{ runner.temp }}/wiseeff-ci-shards" });
    expect(aggregate.steps[3]).toMatchObject({ id: "results", run: `node --experimental-strip-types scripts/ci-shard-results.ts aggregate ${kind}`, env: { EFF_NEEDS: "${{ toJSON(needs) }}" } });
    expect(aggregate.outputs).toEqual(kind === "server"
      ? { receipt: "${{ steps.results.outputs.receipt }}", shadow_server: "${{ steps.results.outputs.shadow }}" }
      : { identity: "${{ steps.results.outputs.identity }}" });
    expect(workflow.jobs.required.needs).toEqual(["detect", "build-and-test", "acceptance-quality", "acceptance-smoke", "acceptance-local-non-hdc", "target-synthetic-acceptance", "minimal-upgrade"]);
  });

  const workerMutations = ["missing-worker", "name", "needs", "condition", "runner", "timeout", "suppressed", "outputs", "empty-outputs",
    "missing-partition", "duplicate-partition", "reordered", "string-partition", "exclude", "include", "extra-axis", "fail-fast", "missing-fail-fast", "throttle", "extra-strategy", "partition-env",
    "missing-service", "service-image", "service-db", "service-user", "service-password", "service-port", "service-health", "database"] as const;
  it.each(partitions.flatMap((partition) => workerMutations.map((mutation) => [...partition, mutation] as const)))
    ("rejects %s worker drift: %s %s %s %s %s", (kind, workerId, _aggregateId, axis, _values, mutation) => {
      const workflow = YAML.parse(compliantWorkflow);
      const worker = workflow.jobs[workerId];
      if (mutation === "missing-worker") delete workflow.jobs[workerId];
      if (mutation === "name") worker.name = "Unstable worker";
      if (mutation === "needs") worker.needs = ["detect", "build-and-test"];
      if (mutation === "condition") worker.if = "success()";
      if (mutation === "runner") worker["runs-on"] = "self-hosted";
      if (mutation === "timeout") worker["timeout-minutes"] += 1;
      if (mutation === "suppressed") worker["continue-on-error"] = true;
      if (mutation === "outputs") worker.outputs = { receipt: "${{ steps.receipt.outputs.receipt }}" };
      if (mutation === "empty-outputs") worker.outputs = {};
      if (mutation === "missing-partition") worker.strategy.matrix[axis].pop();
      if (mutation === "duplicate-partition") worker.strategy.matrix[axis][1] = worker.strategy.matrix[axis][0];
      if (mutation === "reordered") worker.strategy.matrix[axis].reverse();
      if (mutation === "string-partition") worker.strategy.matrix[axis][0] = kind === "server" ? "1" : 1;
      if (mutation === "exclude") worker.strategy.matrix.exclude = [{ [axis]: worker.strategy.matrix[axis][0] }];
      if (mutation === "include") worker.strategy.matrix.include = [{ [axis]: "extra" }];
      if (mutation === "extra-axis") worker.strategy.matrix.extra = ["extra"];
      if (mutation === "fail-fast") worker.strategy["fail-fast"] = true;
      if (mutation === "missing-fail-fast") delete worker.strategy["fail-fast"];
      if (mutation === "throttle") worker.strategy["max-parallel"] = 1;
      if (mutation === "extra-strategy") worker.strategy.unmapped = true;
      if (mutation === "partition-env") worker.env[kind === "server" ? "WISEEFF_CI_SERVER_SHARD" : "WISEEFF_QUALITY_LANE"] = kind === "server" ? "1/2" : "visual";
      if (mutation === "missing-service") delete worker.services;
      if (mutation === "service-image") worker.services.postgres.image = "postgres:16";
      if (mutation === "service-db") worker.services.postgres.env.POSTGRES_DB = "other";
      if (mutation === "service-user") worker.services.postgres.env.POSTGRES_USER = "other";
      if (mutation === "service-password") worker.services.postgres.env.POSTGRES_PASSWORD = "other";
      if (mutation === "service-port") worker.services.postgres.ports = ["5999:5432"];
      if (mutation === "service-health") worker.services.postgres.options = '--health-cmd "true"';
      if (mutation === "database") worker.env.DATABASE_URL = "postgres://wiseeff:wiseeff@remote.internal:5432/wiseeff";
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    });

  const uploadMutations = ["missing", "duplicate", "version", "name", "unqualified-attempt", "wrong-attempt", "cross-kind", "path", "missing-policy", "ignored-files", "condition", "suppressed", "command", "env", "order", "producer"] as const;
  it.each(partitions.flatMap((partition) => uploadMutations.map((mutation) => [...partition, mutation] as const)))
    ("rejects %s receipt upload drift: %s %s %s %s %s", (kind, workerId, _aggregateId, axis, _values, mutation) => {
      const workflow = YAML.parse(compliantWorkflow);
      const worker = workflow.jobs[workerId];
      const upload = worker.steps.find((step: { with?: { path?: string } }) => step.with?.path === "${{ runner.temp }}/wiseeff-ci-shard/receipt.json");
      if (mutation === "missing") worker.steps = worker.steps.filter((step: unknown) => step !== upload);
      if (mutation === "duplicate") worker.steps.push({ ...upload });
      if (mutation === "version") upload.uses = "actions/upload-artifact@v3";
      if (mutation === "name") upload.with.name = `wiseeff-ci-${kind}-\${{ github.run_attempt }}`;
      if (mutation === "unqualified-attempt") upload.with.name = `wiseeff-ci-${kind}-\${{ matrix.${axis} }}`;
      if (mutation === "wrong-attempt") upload.with.name = `wiseeff-ci-${kind}-\${{ github.run_id }}-\${{ matrix.${axis} }}`;
      if (mutation === "cross-kind") upload.with.name = `wiseeff-ci-${kind === "server" ? "quality" : "server"}-\${{ github.run_attempt }}-\${{ matrix.${axis} }}`;
      if (mutation === "path") upload.with.path = "test-results/quality";
      if (mutation === "missing-policy") delete upload.with["if-no-files-found"];
      if (mutation === "ignored-files") upload.with["if-no-files-found"] = "ignore";
      if (mutation === "condition") upload.if = "always()";
      if (mutation === "suppressed") upload["continue-on-error"] = true;
      if (mutation === "command") upload.run = "echo passed";
      if (mutation === "env") upload.env = { WISEEFF_QUALITY_LANE: "visual" };
      if (mutation === "order") {
        const index = worker.steps.indexOf(upload);
        [worker.steps[index - 1], worker.steps[index]] = [worker.steps[index], worker.steps[index - 1]];
      }
      if (mutation === "producer") {
        if (kind === "server") upload.id = "wrong_receipt";
        else upload.name = "Upload quality evidence";
      }
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    });

  const aggregateMutations = ["missing", "name", "condition", "needs", "extra-needs", "runner", "timeout", "suppressed", "strategy", "service", "env",
    "missing-download", "download-version", "download-condition", "download-pattern", "unqualified-attempt", "current-attempt-only", "wrong-attempt", "download-run", "download-repository", "download-path", "merge", "download-suppressed", "download-command",
    "checkout", "node", "node-version", "cache", "install", "results-id", "results-command", "results-suppressed", "results-condition", "results-source", "results-extra-env", "missing-output", "extra-output", "output-source", "order"] as const;
  it.each(partitions.flatMap((partition) => aggregateMutations.map((mutation) => [...partition, mutation] as const)))
    ("rejects %s aggregate drift: %s %s %s %s %s", (kind, _workerId, aggregateId, _axis, _values, mutation) => {
      const workflow = YAML.parse(compliantWorkflow);
      const aggregate = workflow.jobs[aggregateId];
      const download = aggregate.steps[2];
      const results = aggregate.steps[3];
      if (mutation === "missing") delete workflow.jobs[aggregateId];
      if (mutation === "name") aggregate.name = "Unstable aggregate";
      if (mutation === "condition") aggregate.if = "success()";
      if (mutation === "needs") aggregate.needs.pop();
      if (mutation === "extra-needs") aggregate.needs.push("acceptance-smoke");
      if (mutation === "runner") aggregate["runs-on"] = "self-hosted";
      if (mutation === "timeout") aggregate["timeout-minutes"] = 20;
      if (mutation === "suppressed") aggregate["continue-on-error"] = true;
      if (mutation === "strategy") aggregate.strategy = { matrix: { shard: [1, 2] } };
      if (mutation === "service") aggregate.services = workflow.jobs["l1-server-shards"].services;
      if (mutation === "env") aggregate.env = { EFF_NEEDS: "{}" };
      if (mutation === "missing-download") aggregate.steps.splice(2, 1);
      if (mutation === "download-version") download.uses = "actions/download-artifact@v3";
      if (mutation === "download-condition") download.if = "always()";
      if (mutation === "download-pattern") download.with.pattern = `wiseeff-ci-${kind === "server" ? "quality" : "server"}-\${{ github.run_attempt }}-*`;
      if (mutation === "unqualified-attempt") download.with.pattern = `wiseeff-ci-${kind}-*`;
      if (mutation === "current-attempt-only") download.with.pattern = `wiseeff-ci-${kind}-\${{ github.run_attempt }}-*`;
      if (mutation === "wrong-attempt") download.with.pattern = `wiseeff-ci-${kind}-\${{ github.run_id }}-*`;
      if (mutation === "download-run") download.with["run-id"] = "123";
      if (mutation === "download-repository") download.with.repository = "other/WiseEff";
      if (mutation === "download-path") download.with.path = "${{ runner.temp }}/other";
      if (mutation === "merge") download.with["merge-multiple"] = true;
      if (mutation === "download-suppressed") download["continue-on-error"] = true;
      if (mutation === "download-command") download.run = "echo passed";
      if (mutation === "checkout") aggregate.steps[0].uses = "actions/checkout@v3";
      if (mutation === "node") aggregate.steps[1].uses = "actions/setup-node@v3";
      if (mutation === "node-version") aggregate.steps[1].with["node-version-file"] = "other";
      if (mutation === "cache") aggregate.steps[1].with.cache = "npm";
      if (mutation === "install") aggregate.steps.push({ run: "npm ci" });
      if (mutation === "results-id") results.id = "unmapped";
      if (mutation === "results-command") results.run += " || true";
      if (mutation === "results-suppressed") results["continue-on-error"] = true;
      if (mutation === "results-condition") results.if = "success()";
      if (mutation === "results-source") results.env.EFF_NEEDS = "${{ toJSON(steps) }}";
      if (mutation === "results-extra-env") results.env.EFF_STEPS = "${{ toJSON(steps) }}";
      if (mutation === "missing-output") delete aggregate.outputs[kind === "server" ? "receipt" : "identity"];
      if (mutation === "extra-output") aggregate.outputs.unmapped = "${{ steps.results.outputs.receipt }}";
      if (mutation === "output-source") aggregate.outputs[kind === "server" ? "receipt" : "identity"] = "${{ steps.receipt.outputs.receipt }}";
      if (mutation === "order") [aggregate.steps[2], aggregate.steps[3]] = [aggregate.steps[3], aggregate.steps[2]];
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    });

  it.each(["missing", "reordered", "command", "suppressed", "condition", "metadata", "install", "browser", "runtime-env", "step-env", "legacy-gate", "evidence-name", "evidence-path", "report-missing", "report-reordered", "report-command", "report-condition", "report-suppressed", "report-env", "fixture-db", "missing-seed", "conditional-seed", "suppressed-seed", "early-skip-seed", "fixture-lane"])
    ("rejects quality prerequisites, lane execution or evidence drift: %s", (mutation) => {
      const workflow = YAML.parse(compliantWorkflow);
      const worker = workflow.jobs["acceptance-quality-lanes"];
      const evidence = worker.steps.find((step: { name: string }) => step.name === "Upload quality evidence");
      const runtimeReport = worker.steps.find((step: { name: string }) => step.name === "Report quality gate runtime");
      if (mutation === "missing") worker.steps.splice(8, 1);
      if (mutation === "reordered") [worker.steps[8], worker.steps[9]] = [worker.steps[9], worker.steps[8]];
      if (mutation === "command") worker.steps[9].run += " || true";
      if (mutation === "suppressed") worker.steps[9]["continue-on-error"] = true;
      if (mutation === "condition") worker.steps[9].if = "matrix.lane == 'visual'";
      if (mutation === "metadata") worker.steps[8].run = "echo metadata";
      if (mutation === "install") worker.steps[2].run = "npm ci || true";
      if (mutation === "browser") worker.steps[5].run = "echo browser";
      if (mutation === "runtime-env") worker.env.VITE_WISEEFF_RUNTIME_MODE = "mock";
      if (mutation === "step-env") worker.steps[9].env = { WISEEFF_QUALITY_LANE: "visual" };
      if (mutation === "legacy-gate") worker.steps[9].run = "npm run acceptance:quality-run";
      if (mutation === "evidence-name") evidence.with.name = "wiseeff-acceptance-quality";
      if (mutation === "evidence-path") evidence.with.path += "${{ runner.temp }}/wiseeff-ci-shard/receipt.json\n";
      if (mutation === "report-missing") worker.steps = worker.steps.filter((step: unknown) => step !== runtimeReport);
      if (mutation === "report-reordered") [worker.steps[10], worker.steps[11]] = [worker.steps[11], worker.steps[10]];
      if (mutation === "report-command") runtimeReport.run += "echo unmapped\n";
      if (mutation === "report-condition") runtimeReport.if = "success()";
      if (mutation === "report-suppressed") runtimeReport["continue-on-error"] = true;
      if (mutation === "report-env") runtimeReport.env = { WISEEFF_QUALITY_LANE: "visual" };
      if (mutation === "fixture-db") worker.env.DATABASE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/other";
      if (mutation === "missing-seed") worker.steps[7].run = worker.steps[7].run.replace("npm run seed:browser\n", "");
      if (mutation === "conditional-seed") worker.steps[7].run = worker.steps[7].run.replace("npm run seed:browser", "npm run --if-present seed:browser");
      if (mutation === "suppressed-seed") worker.steps[7].run = worker.steps[7].run.replace("seed:browser\n", "seed:browser || true\n");
      if (mutation === "early-skip-seed") worker.steps[7].run = 'echo "WISEEFF_QUALITY_SKIP_SEED=true" >> "$GITHUB_ENV"\n' + worker.steps[7].run;
      if (mutation === "fixture-lane") worker.steps[7].run = worker.steps[7].run.replace('"$WISEEFF_QUALITY_LANE" = "visual"', '"$WISEEFF_QUALITY_LANE" = "consistency-1"');
      expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
    });
});

describe("visual baseline review CI contract", () => {
  it("accepts the visual-only failure gallery after all existing quality steps with separate uploads", () => {
    const workflow = YAML.parse(compliantWorkflow);
    const steps = workflow.jobs["acceptance-quality-lanes"].steps;
    expect(steps.slice(-5).map((step: { name: string }) => step.name)).toEqual([
      "Upload quality lane receipt", "Report quality gate runtime", "Upload quality evidence",
      "Generate candidate baseline review", "Upload candidate baseline review"
    ]);
    expect(evaluateL1CiWorkflow(compliantWorkflow)).toEqual({ status: "passed", errors: [] });
  });

  it.each(["missing-generator", "missing-upload", "duplicate", "order", "generator-condition", "generator-lane", "generator-command", "generator-suppressed", "generator-env", "generator-shell", "upload-condition", "upload-lane", "upload-candidate-guard", "upload-version", "upload-name", "upload-path", "upload-policy", "upload-suppressed", "upload-env", "upload-command"])("rejects candidate gallery drift: %s", (mutation) => {
    const workflow = YAML.parse(compliantWorkflow);
    const worker = workflow.jobs["acceptance-quality-lanes"];
    const generator = worker.steps.find((step: { name: string }) => step.name === "Generate candidate baseline review");
    const upload = worker.steps.find((step: { name: string }) => step.name === "Upload candidate baseline review");
    if (mutation === "missing-generator") worker.steps = worker.steps.filter((step: unknown) => step !== generator);
    if (mutation === "missing-upload") worker.steps = worker.steps.filter((step: unknown) => step !== upload);
    if (mutation === "duplicate") worker.steps.push({ ...generator });
    if (mutation === "order") {
      worker.steps = worker.steps.filter((step: unknown) => step !== generator);
      worker.steps.splice(worker.steps.indexOf(upload) - 2, 0, generator);
    }
    if (mutation === "generator-condition") generator.if = "always() && matrix.lane == 'visual'";
    if (mutation === "generator-lane") generator.if = "failure() && matrix.lane == 'consistency-1'";
    if (mutation === "generator-command") generator.run += " || true";
    if (mutation === "generator-suppressed") generator["continue-on-error"] = true;
    if (mutation === "generator-env") generator.env = { RUNNER_TEMP: "/other" };
    if (mutation === "generator-shell") generator.shell = "bash --noprofile --norc -c {0}";
    if (mutation === "upload-condition") upload.if = "always()";
    if (mutation === "upload-lane") upload.if = upload.if.replace("'visual'", "'accessibility'");
    if (mutation === "upload-candidate-guard") upload.if = "failure() && matrix.lane == 'visual'";
    if (mutation === "upload-version") upload.uses = "actions/upload-artifact@v3";
    if (mutation === "upload-name") upload.with.name = "wiseeff-ci-quality-${{ github.run_attempt }}-${{ matrix.lane }}";
    if (mutation === "upload-path") upload.with.path = "test-results/quality";
    if (mutation === "upload-policy") upload.with["if-no-files-found"] = "ignore";
    if (mutation === "upload-suppressed") upload["continue-on-error"] = true;
    if (mutation === "upload-env") upload.env = { WISEEFF_QUALITY_LANE: "visual" };
    if (mutation === "upload-command") upload.run = "git apply --binary candidate.patch";
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
});

describe("M5.12 acceptance CI configuration", () => {
  it("keeps four independent owned-runtime shards and the stable always-running L2 aggregate", () => {
    const workflow = YAML.parse(compliantWorkflow);
    const shards = workflow.jobs["acceptance-local-non-hdc-shards"];
    expect(shards.strategy).toEqual({ "fail-fast": false, matrix: { shard: [1, 2, 3, 4] } });
    expect(shards.services.postgres.image).toBe("pgvector/pgvector:pg16");
    expect(shards.steps.find((step: any) => step.id === "acceptance_gate0").run).toBe("npm run acceptance:gate0 -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}");
    expect(workflow.jobs["acceptance-local-non-hdc"]).toMatchObject({ name: "Acceptance local non-HDC", if: ciAggregateEventCondition, needs: ["detect", "acceptance-local-non-hdc-shards"], "timeout-minutes": 5 });
    expect(workflow.jobs.required.needs).toContain("acceptance-local-non-hdc");
  });
  it.each(["missing-shard", "duplicate-shard", "exclude", "fail-fast", "throttle", "unsharded", "suppressed", "detect", "service", "aggregate-if", "aggregate-needs", "aggregate-command", "aggregate-name"])("rejects unsafe L2 scheduling drift: %s", (mutation) => {
    const workflow = YAML.parse(compliantWorkflow);
    const shards = workflow.jobs["acceptance-local-non-hdc-shards"];
    const aggregate = workflow.jobs["acceptance-local-non-hdc"];
    if (mutation === "missing-shard") shards.strategy.matrix.shard.pop();
    if (mutation === "duplicate-shard") shards.strategy.matrix.shard = [1, 2, 2, 4];
    if (mutation === "exclude") shards.strategy.matrix.exclude = [{ shard: 1 }];
    if (mutation === "fail-fast") shards.strategy["fail-fast"] = true;
    if (mutation === "throttle") shards.strategy["max-parallel"] = 1;
    if (mutation === "unsharded") shards.steps.find((step: any) => step.id === "acceptance_gate0").run = "npm run acceptance:gate0";
    if (mutation === "suppressed") shards.steps.find((step: any) => step.id === "acceptance_gate0")["continue-on-error"] = true;
    if (mutation === "detect") shards.if = "always()";
    if (mutation === "service") delete shards.services;
    if (mutation === "aggregate-if") aggregate.if = "success()";
    if (mutation === "aggregate-needs") aggregate.needs = ["detect"];
    if (mutation === "aggregate-command") aggregate.steps[2].run = "true";
    if (mutation === "aggregate-name") aggregate.name = "Acceptance local non-HDC aggregate";
    expect(evaluateL1CiWorkflow(YAML.stringify(workflow)).status).toBe("failed");
  });
  it.each(["evidence", "diagnostic"])("rejects colliding per-shard artifact names: %s", (kind) => {
    const workflow = YAML.parse(compliantWorkflow);
    const steps = workflow.jobs["acceptance-local-non-hdc-shards"].steps;
    steps.find((step: any) => step.id === (kind === "evidence" ? "acceptance_evidence_upload" : "acceptance_diagnostic_upload")).with.name = "unsharded-name";
    expect(evaluateImmutableAcceptanceUpload(YAML.stringify(workflow)).status).toBe("failed");
  });
  it("keeps the L2 platform budget strictly above bounded prelude, Gate0 owner, and always finalization", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const budget = evaluateAcceptanceLocalNonHdcBudget(workflow);

    expect(budget).toMatchObject({
      status: "passed",
      jobTimeoutMinutes: 155,
      platformOverheadMinutes: 5,
      preGate0BudgetMinutes: 73,
      gate0OwnerMinutes: 60,
      artifactSafetyMinutes: 5,
      artifactUploadMinutes: 5,
      requiredExclusiveFloorMinutes: 154,
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
      requiredExclusiveFloorMinutes: 158,
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
      requiredExclusiveFloorMinutes: 158,
      missingStepTimeouts: [],
    });
  });

  it("routes every acceptance spec through the helper except the frozen main exceptions", () => {
    const sources = readAcceptanceEnvironmentSources();

    expect(requiredAcceptanceEnvironmentHelperExceptions).toEqual([
      "e2e/acceptance/catalog-publication-delivery.acceptance.spec.ts",
      "e2e/acceptance/config-set-revision-gate.acceptance.spec.ts",
      "e2e/acceptance/dts-reload-deploy.acceptance.spec.ts",
      "e2e/acceptance/runtime-warmup.spec.ts",
      "e2e/acceptance/shell-navigation.acceptance.spec.ts",
    ]);
    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    const loaded = new Set(findAcceptanceEnvironmentHelperLoads(sources));
    const helperlessPaths = sources.filter(({ path }) => !loaded.has(path)).map(({ path }) => path);
    expect(helperlessPaths).toEqual(requiredAcceptanceEnvironmentHelperExceptions);
    expect(findMissingAcceptanceEnvironmentHelperLoads(sources)).toEqual([]);
    expect(loaded.has("e2e/acceptance/canonical-dashboard.acceptance.spec.ts")).toBe(true);
    expect(loaded.has("e2e/acceptance/canonical-dts-reload.acceptance.spec.ts")).toBe(true);
  });

  it("routes both Playwright acceptance configs through the same owned-runtime-aware helper", () => {
    const sources = readAcceptanceConfigurationSources();

    expect(sources.map(({ path }) => path)).toEqual(requiredAcceptanceEnvironmentConfigurationPaths);
    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    expect(findAcceptanceEnvironmentHelperLoads(sources)).toEqual(requiredAcceptanceEnvironmentConfigurationPaths);
    expect(findMissingAcceptanceEnvironmentHelperLoads(sources)).toEqual([]);
  });

  it("fails closed for an unlisted spec, a removed exception, or a missing config", () => {
    const evaluateSources = (acceptanceEnvironmentSources: typeof compliantAcceptanceEnvironmentSources) =>
      evaluateAcceptanceCiConfiguration({
        packageJson: { scripts: compliantScripts },
        workflowText: compliantWorkflow,
        smokeTagCount: 3,
        acceptanceEnvironmentSources,
      });
    const newSpecPath = "e2e/acceptance/new.acceptance.spec.ts";
    const missingHelper = evaluateSources([
      ...compliantAcceptanceEnvironmentSources,
      { path: newSpecPath, source: '// loadAcceptanceEnvironment();\nimport { test } from "playwright/test";' },
    ]);
    expect(missingHelper.acceptanceEnvironmentGate).toBe(false);
    expect(missingHelper.missingAcceptanceEnvironmentHelperPaths).toContain(newSpecPath);

    const removedExceptionPath = requiredAcceptanceEnvironmentHelperExceptions[0];
    const removedException = evaluateSources(
      compliantAcceptanceEnvironmentSources.filter(({ path }) => path !== removedExceptionPath),
    );
    expect(removedException.acceptanceEnvironmentGate).toBe(false);
    expect(removedException.missingAcceptanceEnvironmentExceptionPaths).toContain(removedExceptionPath);

    const renamedExceptionPath = "e2e/acceptance/renamed-catalog-publication-delivery.acceptance.spec.ts";
    const renamedException = evaluateSources(compliantAcceptanceEnvironmentSources.map((source) =>
      source.path === removedExceptionPath ? { ...source, path: renamedExceptionPath } : source,
    ));
    expect(renamedException.acceptanceEnvironmentGate).toBe(false);
    expect(renamedException.missingAcceptanceEnvironmentHelperPaths).toContain(renamedExceptionPath);
    expect(renamedException.missingAcceptanceEnvironmentExceptionPaths).toContain(removedExceptionPath);

    for (const configurationPath of requiredAcceptanceEnvironmentConfigurationPaths) {
      const missingConfiguration = evaluateSources(
        compliantAcceptanceEnvironmentSources.filter(({ path }) => path !== configurationPath),
      );
      expect(missingConfiguration.acceptanceEnvironmentGate).toBe(false);
      expect(missingConfiguration.missingAcceptanceEnvironmentConfigurationPaths).toContain(configurationPath);
    }

    const noSources = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: compliantWorkflow,
      smokeTagCount: 3,
    });
    expect(noSources.acceptanceEnvironmentGate).toBe(false);
  });

  it("rejects dotenv/config in any acceptance spec or Playwright config", () => {
    for (const path of [
      "e2e/acceptance/auth-runtime.acceptance.spec.ts",
      requiredAcceptanceEnvironmentConfigurationPaths[0],
    ]) {
      const sources = compliantAcceptanceEnvironmentSources.map((source) =>
        source.path === path ? { ...source, source: `${source.source}\nimport "dotenv/config";` } : source,
      );
      const result = evaluateAcceptanceCiConfiguration({
        packageJson: { scripts: compliantScripts },
        workflowText: compliantWorkflow,
        smokeTagCount: 3,
        acceptanceEnvironmentSources: sources,
      });

      expect(result.acceptanceEnvironmentGate).toBe(false);
      expect(result.forbiddenAcceptanceDotenvImports).toEqual([path]);
    }
  });

  it("requires layered job ids, smoke, and the inventoried quality runner", () => {
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
        "node --experimental-strip-types scripts/ci-shard-results.ts quality",
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
      smokeTagCount: 3,
      acceptanceEnvironmentSources: compliantAcceptanceEnvironmentSources,
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
        w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.name === "Upload acceptance evidence").uses = `actions/upload-artifact@${ref}`;
      }),
      (w: any) => w.jobs["acceptance-local-non-hdc-shards"].steps.push({ uses: "actions/upload-artifact@v3", with: { path: "." } }),
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_diagnostic_upload").with.path = "test-results/**"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_diagnostic")["continue-on-error"] = true; },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_diagnostic").shell = "python3 {0}"; },
      (w: any) => { const steps = w.jobs["acceptance-local-non-hdc-shards"].steps; steps.push(...steps.splice(1, 1)); },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps = w.jobs["acceptance-local-non-hdc-shards"].steps.filter((s: any) => s.id !== "acceptance_diagnostic_fallback"); },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_index_upload").with.path = "test-results/**"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_index").env.EFF_INDEX_POLICY_DIGEST = "candidate-controlled"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_index").env.EFF_ARCHIVE = "success"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_index_stage").env.EFF_BASE_SHA = "${{ github.event.pull_request.base.sha }}"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc-shards"].steps.find((s: any) => s.id === "acceptance_index_stage").shell = "python3 {0}"; },
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
    const qualityJob = workflow.split("\n  acceptance-quality-lanes:")[1]?.split("\n  acceptance-quality:")[0] ?? "";
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
