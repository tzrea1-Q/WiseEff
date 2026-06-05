import { describe, expect, it } from "vitest";
import {
  buildCapacityGateEvidence,
  buildCapacityInput,
  buildK6Command,
  evaluateCapacityGate,
  parseCapacityGateArgs,
  redactCapacitySecret,
  runCapacityGate,
  type CapacityGateInput
} from "./run-capacity-gate";

const baseInput: CapacityGateInput = {
  metadata: {
    targetUrl: "https://wiseeff-staging.example.test",
    environment: "self-hosted-staging",
    profile: "pilot-smoke",
    duration: "2m",
    vus: 10,
    safeWritesEnabled: false
  },
  thresholds: {
    p95LatencyMs: 750,
    errorRate: 0.01,
    minThroughputRps: 5,
    maxCpuPercent: 80,
    maxMemoryPercent: 85,
    maxDbConnections: 40,
    maxQueueBacklog: 25,
    objectStoreProbeRequired: true
  },
  observed: {
    p95LatencyMs: 420,
    errorRate: 0,
    throughputRps: 9,
    cpuPercent: 42,
    memoryPercent: 51,
    dbConnections: 12,
    queueBacklog: 0,
    objectStoreProbeStatus: "passed"
  },
  artifacts: {
    k6SummaryPath: "test-results/capacity/k6-summary.json",
    metricsSnapshotPath: "test-results/capacity/prometheus-snapshot.json"
  }
};

describe("capacity gate", () => {
  it("passes when target evidence meets first-pilot thresholds", () => {
    const result = evaluateCapacityGate(baseInput);

    expect(result).toEqual({ status: "passed", blockers: [], pending: [] });
  });

  it("blocks missing target URL and breached thresholds", () => {
    const result = evaluateCapacityGate({
      ...baseInput,
      metadata: { ...baseInput.metadata, targetUrl: "" },
      observed: {
        ...baseInput.observed,
        p95LatencyMs: 1200,
        errorRate: 0.05,
        throughputRps: 2,
        queueBacklog: 80,
        objectStoreProbeStatus: "failed"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Target URL is required for capacity evidence.",
        "p95 latency 1200ms exceeds threshold 750ms.",
        "error rate 0.05 exceeds threshold 0.01.",
        "throughput 2 rps is below threshold 5 rps.",
        "queue backlog 80 exceeds threshold 25.",
        "object-store probe did not pass."
      ])
    );
  });

  it("does not accept local URLs as target capacity evidence", () => {
    const result = evaluateCapacityGate({
      ...baseInput,
      metadata: {
        ...baseInput.metadata,
        targetUrl: "http://127.0.0.1:8787"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("Target URL must be a non-local http(s) URL for capacity evidence.");
  });

  it("does not accept local or placeholder environment labels as target capacity evidence", () => {
    const result = evaluateCapacityGate({
      ...baseInput,
      metadata: {
        ...baseInput.metadata,
        environment: "local-self-hosted"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Capacity environment must identify a configured target, staging, pilot, or self-hosted environment."
    );
  });

  it("requires k6 summary and metrics snapshot artifact references", () => {
    const result = evaluateCapacityGate({
      ...baseInput,
      artifacts: {
        k6SummaryPath: "",
        metricsSnapshotPath: ""
      }
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining(["k6 summary artifact path is required.", "metrics snapshot artifact path is required."])
    );
  });

  it("marks infrastructure metrics pending when they were not collected", () => {
    const result = evaluateCapacityGate({
      ...baseInput,
      observed: {
        p95LatencyMs: 300,
        errorRate: 0,
        throughputRps: 7,
        cpuPercent: null,
        memoryPercent: null,
        dbConnections: null,
        queueBacklog: null,
        objectStoreProbeStatus: "pending"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.pending).toEqual(
      expect.arrayContaining([
        "CPU utilization evidence is pending.",
        "memory utilization evidence is pending.",
        "database connection evidence is pending.",
        "queue backlog evidence is pending.",
        "object-store probe evidence is pending."
      ])
    );
  });

  it("redacts authorization secrets from commands and evidence", () => {
    expect(redactCapacitySecret("Bearer abc.def.ghi")).toBe("Bearer <redacted>");
    expect(redactCapacitySecret("https://x.test?api_key=secret&token=abc")).toBe(
      "https://x.test?api_key=<redacted>&token=<redacted>"
    );

    const evidence = buildCapacityGateEvidence({
      date: "2026-06-03T00:00:00.000Z",
      input: {
        ...baseInput,
        metadata: {
          ...baseInput.metadata,
          targetUrl: "https://wiseeff-staging.example.test?token=secret"
        }
      },
      result: evaluateCapacityGate(baseInput)
    });

    expect(evidence).toContain("## M6.6 Capacity Gate Evidence");
    expect(evidence).toContain("- Target URL: `https://wiseeff-staging.example.test?token=<redacted>`");
    expect(evidence).toContain("| p95 latency | 420ms | <= 750ms |");
    expect(evidence).not.toContain("token=secret");
  });

  it("builds a k6 command without leaking the auth token", () => {
    const command = buildK6Command({
      targetUrl: "https://wiseeff-staging.example.test",
      authorization: "Bearer secret-token",
      vus: 5,
      duration: "30s",
      summaryPath: "test-results/capacity/k6-summary.json",
      scriptPath: "e2e/capacity/wiseeff-smoke.k6.js"
    });

    expect(command.command).toBe("k6");
    expect(command.args).toContain("e2e/capacity/wiseeff-smoke.k6.js");
    expect(command.env.WISEEFF_CAPACITY_AUTHORIZATION).toBe("Bearer secret-token");
    expect(command.display).toContain("WISEEFF_CAPACITY_AUTHORIZATION=Bearer <redacted>");
    expect(command.display).not.toContain("secret-token");
  });

  it("parses CLI threshold overrides", () => {
    expect(
      parseCapacityGateArgs([
        "--target-url",
        "https://target.example.test",
        "--environment",
        "stage-a",
        "--vus",
        "12",
        "--duration",
        "90s",
        "--p95-ms",
        "900",
        "--error-rate",
        "0.02",
        "--min-rps",
        "8"
      ])
    ).toMatchObject({
      targetUrl: "https://target.example.test",
      environment: "stage-a",
      vus: 12,
      duration: "90s",
      thresholds: {
        p95LatencyMs: 900,
        errorRate: 0.02,
        minThroughputRps: 8
      }
    });
  });

  it("builds observed metric input from CLI evidence values", () => {
    const options = parseCapacityGateArgs([
      "--target-url",
      "https://target.example.test",
      "--observed-p95-ms",
      "410",
      "--observed-error-rate",
      "0",
      "--observed-rps",
      "9",
      "--observed-cpu",
      "40",
      "--observed-memory",
      "55",
      "--observed-db-connections",
      "10",
      "--observed-queue-backlog",
      "0",
      "--object-store-probe",
      "passed"
    ]);

    expect(buildCapacityInput(options).observed).toEqual({
      p95LatencyMs: 410,
      errorRate: 0,
      throughputRps: 9,
      cpuPercent: 40,
      memoryPercent: 55,
      dbConnections: 10,
      queueBacklog: 0,
      objectStoreProbeStatus: "passed"
    });
    expect(evaluateCapacityGate(buildCapacityInput(options)).status).toBe("passed");
  });

  it("fails the gate when the k6 command fails even if observed metrics look healthy", () => {
    const result = runCapacityGate(
      parseCapacityGateArgs([
        "--target-url",
        "https://target.example.test",
        "--run-k6",
        "--observed-p95-ms",
        "410",
        "--observed-error-rate",
        "0",
        "--observed-rps",
        "9",
        "--observed-cpu",
        "40",
        "--observed-memory",
        "55",
        "--observed-db-connections",
        "10",
        "--observed-queue-backlog",
        "0",
        "--object-store-probe",
        "passed",
        "--output",
        "test-results/capacity/k6-failed-evidence.md"
      ]),
      () => ({ status: 1, output: "k6 failed with timeout" })
    );

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain("k6 capacity command failed.");
  });

  it("accepts npm-config environment flags and stripped positional PowerShell values", () => {
    expect(
      parseCapacityGateArgs(["https://target.example.test", "docs/generated/capacity-gate.md"], {
        npm_config_target_url: "true",
        npm_config_output: "true",
        npm_config_environment: "stage-b",
        npm_config_vus: "4",
        npm_config_duration: "45s"
      })
    ).toMatchObject({
      targetUrl: "https://target.example.test",
      output: "docs/generated/capacity-gate.md",
      environment: "stage-b",
      vus: 4,
      duration: "45s"
    });
  });
});
