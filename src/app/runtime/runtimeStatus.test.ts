import { describe, expect, it } from "vitest";

import {
  createInitialApiRuntimeStatus,
  markRuntimeDomainLoading,
  markRuntimeDomainReady,
  markRuntimeDomainUnavailable,
  requiredDomainsForPage,
  resetRuntimeDomainForRetry,
  selectBlockingRuntimeStatus
} from "./runtimeStatus";

describe("runtimeStatus", () => {
  it("tracks loading, ready, unavailable, and retry states", () => {
    let status = createInitialApiRuntimeStatus();

    status = markRuntimeDomainLoading(status, "parameters");
    expect(status.parameters).toEqual({ state: "loading" });

    status = markRuntimeDomainReady(status, "parameters", "2026-06-11T00:00:00.000Z");
    expect(status.parameters).toEqual({ state: "ready", loadedAt: "2026-06-11T00:00:00.000Z" });

    status = markRuntimeDomainUnavailable(status, "parameters", "参数 API 暂不可用");
    expect(status.parameters).toEqual({ state: "unavailable", message: "参数 API 暂不可用", retryKey: 1 });

    status = resetRuntimeDomainForRetry(status, "parameters");
    expect(status.parameters).toEqual({ state: "loading" });
  });

  it("maps pages to required API domains", () => {
    expect(requiredDomainsForPage("parameters")).toEqual(["auth", "parameters", "users"]);
    expect(requiredDomainsForPage("parameter-review")).toEqual(["auth", "parameters", "users"]);
    expect(requiredDomainsForPage("logs")).toEqual(["auth", "logs"]);
    expect(requiredDomainsForPage("node-debugging")).toEqual(["auth", "debugging"]);
    expect(requiredDomainsForPage("user-permissions")).toEqual(["auth", "users"]);
    expect(requiredDomainsForPage("home")).toEqual(["auth"]);
  });

  it("returns the first blocking required domain and ignores unrelated partial failures", () => {
    let status = createInitialApiRuntimeStatus();
    status = markRuntimeDomainReady(status, "auth", "2026-06-11T00:00:00.000Z");
    status = markRuntimeDomainReady(status, "logs", "2026-06-11T00:00:00.000Z");
    status = markRuntimeDomainUnavailable(status, "parameters", "参数 API 暂不可用");

    expect(selectBlockingRuntimeStatus("logs", status)).toBeNull();
    expect(selectBlockingRuntimeStatus("parameters", status)).toMatchObject({
      domain: "parameters",
      status: { state: "unavailable", message: "参数 API 暂不可用" }
    });
  });
});
