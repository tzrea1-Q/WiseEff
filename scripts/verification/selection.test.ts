import { expect, it } from "vitest";
import { selectModules } from "./selection";

it("selects affected feedback modules and reverse dependencies", () => {
  const registry = [
    { id: "feedback-domain", status: "observation-pending", risk: "R3", paths: ["src/domain/productFeedback/"], dependencies: [], consumers: ["src/domain-consumer.ts"], tasks: { "frontend-tests": ["src/infrastructure/http/productFeedbackClient.test.ts"] } },
    { id: "feedback-client", status: "observation-pending", risk: "R2", paths: ["src/infrastructure/http/productFeedbackClient.ts"], dependencies: ["feedback-domain"], consumers: [], tasks: { "frontend-tests": ["src/infrastructure/http/productFeedbackClient.test.ts"] } },
  ];
  const result = selectModules({ changed: [{ status: "M", paths: ["src/domain-consumer.ts"] }], base: registry, head: registry });
  expect(result.modules).toEqual(["feedback-client", "feedback-domain"]);
  expect(result.fullFallback).toBe(false);
});

it("broadens unknown, deletion, and registry-missing changes", () => {
  const registry = [{ id: "feedback-domain", status: "observation-pending", risk: "R3", paths: ["src/domain/productFeedback/"], dependencies: [], consumers: [], tasks: { "frontend-tests": ["src/infrastructure/http/productFeedbackClient.test.ts"] } }];
  const unknown = selectModules({ changed: [{ status: "M", paths: ["src/other/file.ts"] }], base: registry, head: registry });
  expect(unknown.fullFallback).toBe(true);
  expect(unknown.modules).toEqual(["feedback-client", "feedback-domain", "feedback-server", "feedback-ui"]);
  expect(selectModules({ changed: [{ status: "D", paths: ["src/domain/productFeedback/model.ts"] }], base: registry, head: registry }).fullFallback).toBe(true);
  expect(selectModules({ changed: [], base: null, head: registry }).fullFallback).toBe(true);
});

it("broadens a path shared by multiple modules", () => {
  const shared = { id: "feedback-domain", status: "observation-pending" as const, risk: "R3" as const, paths: ["src/shared.ts"], dependencies: [], consumers: [], tasks: {}, browser: { spec: "e2e/shared.spec.ts", pages: ["shared"], roles: ["user"], flows: ["read"], environment: "owned-postgres-browser" as const } };
  const other = { ...shared, id: "feedback-client" as const, risk: "R2" as const };
  const result = selectModules({ changed: [{ status: "M", paths: ["src/shared.ts"] }], base: [shared, other], head: [shared, other] });
  expect(result.fullFallback).toBe(true);
  expect(result.reasons).toContain("UNKNOWN_OR_SHARED_PATH_FULL");
});
