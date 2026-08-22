import { expect, type APIRequestContext, type TestInfo } from "playwright/test";

import { writeOperationJsonArtifact } from "./operationEvidence";
import { apiRoute } from "./runtime";

const deterministicReadyMessage = "Xiaoze deterministic mode; LLM API not required.";

export async function assertDeterministicXiaozeReady(
  request: APIRequestContext,
  testInfo: TestInfo
) {
  const response = await request.get(apiRoute("/health/ready"));
  expect([200, 503]).toContain(response.status());
  const body = (await response.json()) as {
    dependencies?: { xiaozeLlm?: { status?: string; message?: string } };
  };
  expect(body.dependencies?.xiaozeLlm).toMatchObject({
    status: "ready",
    message: deterministicReadyMessage
  });

  const evidence = {
    mode: "deterministic",
    dependency: {
      status: body.dependencies?.xiaozeLlm?.status,
      message: body.dependencies?.xiaozeLlm?.message
    },
    externalProviderRequests: 0,
    evidenceBasis: {
      kind: "in-process-production-model-factory-guard",
      contractTest:
        "server/modules/agent/xiaoze/agUiEndpoint.concurrency.test.ts: runs without constructing the production model in deterministic mode",
      statement:
        "The deterministic factory/run contract injects a throwing production model factory and proves a successful run with zero factory calls. This is not a network-traffic counter."
    }
  } as const;
  const artifact = await writeOperationJsonArtifact(
    testInfo,
    "xiaoze-deterministic-provider-evidence.json",
    evidence
  );
  testInfo.annotations.push({
    type: "xiaoze-deterministic-provider-evidence",
    description:
      "externalProviderRequests=0 is backed by the in-process production-model-factory guard; it is not network telemetry."
  });

  return { artifact, evidence };
}
