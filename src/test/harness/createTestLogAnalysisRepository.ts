import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { LogRecord } from "@/domain/logs/types";
import { createPrototypeState } from "@/infrastructure/mock/prototypeState";

import { withPortSpies } from "./withPortSpies";

/**
 * Test-only log port. Production mock mode keeps logs on prototype state and
 * does not ship a mock adapter; API-mode App tests still need an in-memory
 * repository so hydration does not hit HTTP.
 */
export function createTestLogAnalysisRepository(
  logs: readonly LogRecord[] | (() => readonly LogRecord[]) = () => createPrototypeState().logs,
  overrides: Partial<LogAnalysisRepository> = {}
): LogAnalysisRepository {
  const readLogs = () => (typeof logs === "function" ? logs() : logs);

  const base: LogAnalysisRepository = {
    async listLogs() {
      return [...readLogs()];
    },
    async getLog(logId) {
      return readLogs().find((log) => log.id === logId) ?? null;
    },
    async uploadLog() {
      throw new Error("createTestLogAnalysisRepository.uploadLog is not stubbed");
    },
    async getJob() {
      throw new Error("createTestLogAnalysisRepository.getJob is not stubbed");
    },
    async rerunLog() {
      throw new Error("createTestLogAnalysisRepository.rerunLog is not stubbed");
    },
    async archiveLog() {
      return;
    },
    async unarchiveLog() {
      return;
    },
    async submitFeedback() {
      return;
    },
    async listLogDomains() {
      return [];
    },
    async listFeedbackInsights() {
      return [];
    }
  };

  return withPortSpies(base, overrides);
}
