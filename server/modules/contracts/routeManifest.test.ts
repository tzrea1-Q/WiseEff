import { describe, expect, it } from "vitest";
import { routeManifest } from "./routeManifest";

describe("routeManifest", () => {
  it("keeps route ids unique", () => {
    const ids = routeManifest.map((route) => route.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the M1-M4 commercial readiness route groups", () => {
    const groups = [...new Set(routeManifest.map((route) => route.module))];

    expect(groups).toEqual(expect.arrayContaining(["parameters", "logs", "jobs", "debugging", "agent", "operations"]));
  });

  it("locks high-risk M1-M5 route paths", () => {
    expect(routeManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "xiaoze.run",
          method: "POST",
          path: "/api/v1/agent/xiaoze"
        }),
        expect.objectContaining({
          id: "debugging.writeNode",
          method: "POST",
          path: "/api/v1/debugging/nodes/write"
        }),
        expect.objectContaining({
          id: "logs.upload",
          method: "POST",
          path: "/api/v1/logs"
        }),
        expect.objectContaining({
          id: "parameters.reviewChangeRequest",
          method: "POST",
          path: "/api/v1/parameter-change-requests/:requestId/review"
        }),
        expect.objectContaining({
          id: "operations.pilotReadiness",
          method: "GET",
          path: "/api/v1/operations/pilot-readiness"
        })
      ])
    );
  });
});
