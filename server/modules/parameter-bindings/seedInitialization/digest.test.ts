import { describe, expect, it } from "vitest";

import { canonicalSeedInitializationDigest } from "./digest";

const file = (projectId: string, name: "board.dts" | "charging-thermal.dts" | "power-config.json", content: string) => ({
  projectId,
  name,
  content,
});

const threeProjects = (json: string) =>
  ["atlas", "aurora", "nebula"].flatMap((projectId) => [
    file(projectId, "board.dts", "dts"),
    file(projectId, "charging-thermal.dts", "thermal"),
    file(projectId, "power-config.json", json),
  ]);

describe("canonicalSeedInitializationDigest", () => {
  it("is stable for the same bytes and changes when JSON is omitted or altered", () => {
    const organizationId = "org-seed";
    const first = canonicalSeedInitializationDigest({
      organizationId,
      files: threeProjects('{"charger.cv.limitMv":4300}'),
    });
    const second = canonicalSeedInitializationDigest({
      organizationId,
      files: threeProjects('{"charger.cv.limitMv":4300}'),
    });
    expect(first).toBe(second);
    expect(first.startsWith("sha256:")).toBe(true);

    const withoutJson = () =>
      canonicalSeedInitializationDigest({
        organizationId,
        files: ["atlas", "aurora", "nebula"].flatMap((projectId) => [
          file(projectId, "board.dts", "dts"),
          file(projectId, "charging-thermal.dts", "thermal"),
        ]),
      });
    expect(withoutJson).toThrow(/power-config.json/);

    const altered = canonicalSeedInitializationDigest({
      organizationId,
      files: threeProjects('{"charger.cv.limitMv":4380}'),
    });
    expect(altered).not.toBe(first);
  });
});
