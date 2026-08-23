import type { TestInfo } from "playwright/test";

import { acceptanceOperations } from "../acceptance/operationMatrix";

export const FAILURE_ROUTE_ANNOTATION_TYPE = "route";
export const VISUAL_XIAOZE_FAILURE_ROUTE = "/parameters";
export const VISUAL_INTERACTION_FAILURE_ROUTE = "/organization/members";
export const PARAMETER_TOPOLOGY_FAILURE_ROUTE = operationRoute("PARAM-TOPOLOGY-BROWSE-001");
export const PROJECT_CONFIGURATION_BASELINE_FAILURE_ROUTE = operationRoute(
  "PROJ-CONFIG-BASELINE-001",
).replace(":projectId", "aurora");

type FailureRouteAnnotation = {
  type: string;
  description?: string;
};

const retainedReportRoutes = new Map([
  [
    reportKey("visual.quality.spec.ts", "keeps stable visual baseline for the Xiaoze popup"),
    VISUAL_XIAOZE_FAILURE_ROUTE,
  ],
  ...[
    "captures the primary button hover state",
    "captures the primary button keyboard focus-visible state",
    "captures the ModalDialog open state with backdrop",
    "captures the data-table row hover state",
    "captures the data-table sort header keyboard focus state",
  ].map((title) => [
    reportKey("visual.quality.spec.ts", title),
    VISUAL_INTERACTION_FAILURE_ROUTE,
  ] as const),
  [
    reportKey(
      "parameter-topology.acceptance.spec.ts",
      "governs specs, browses real topology, edits, maps identity, and gates publish",
    ),
    PARAMETER_TOPOLOGY_FAILURE_ROUTE,
  ],
  [
    reportKey(
      "project-configuration-workbench.acceptance.spec.ts",
      "creates, compares, releases, and restores baselines in source context",
    ),
    PROJECT_CONFIGURATION_BASELINE_FAILURE_ROUTE,
  ],
]);

export function annotateFailureRoute(testInfo: TestInfo, route: string) {
  if (!/^\/(?:[A-Za-z0-9_:%.-]+(?:\/[A-Za-z0-9_:%.-]+)*)?$/u.test(route)) {
    throw new Error(`Failure route annotation must be a pathname without query or fragment: ${route}`);
  }
  if (
    !testInfo.annotations.some(
      (annotation) =>
        annotation.type === FAILURE_ROUTE_ANNOTATION_TYPE && annotation.description === route,
    )
  ) {
    testInfo.annotations.push({ type: FAILURE_ROUTE_ANNOTATION_TYPE, description: route });
  }
}

export function resolveFailureRouteMetadata(input: {
  file: string;
  title: string;
  annotations: FailureRouteAnnotation[];
}) {
  const annotation = input.annotations.find(
    (candidate) =>
      candidate.type === FAILURE_ROUTE_ANNOTATION_TYPE &&
      typeof candidate.description === "string" &&
      candidate.description.trim(),
  );
  if (annotation?.description) return annotation.description.trim();
  return retainedReportRoutes.get(reportKey(input.file, input.title));
}

function operationRoute(operationId: string) {
  const operation = acceptanceOperations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Acceptance operation ${operationId} is missing route metadata.`);
  return operation.route;
}

function reportKey(file: string, title: string) {
  return `${file.replace(/^.*[\\/]/u, "")}\0${title}`;
}
