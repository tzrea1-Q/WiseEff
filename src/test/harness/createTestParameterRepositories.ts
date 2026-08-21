import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { createMockDtsStructuredRepository } from "@/infrastructure/mock/mockDtsStructuredRepository";
import { createMockParameterFileRepository } from "@/infrastructure/mock/mockParameterFileRepository";

import { withPortSpies } from "./withPortSpies";

/** Fresh production mock adapter with observable methods and per-method overrides. */
export function createTestDtsStructuredRepository(
  overrides: Partial<DtsStructuredRepository> = {}
): DtsStructuredRepository {
  return withPortSpies(createMockDtsStructuredRepository(), overrides);
}

/** Fresh production mock adapter with observable methods and per-method overrides. */
export function createTestParameterFileRepository(
  overrides: Partial<ParameterFileRepository> = {}
): ParameterFileRepository {
  return withPortSpies(createMockParameterFileRepository(), overrides);
}
