import { describe, expect, it } from "vitest";

import { buildConnectUrl, parseConnectUrl } from "./urlScheme";

describe("urlScheme", () => {
  it("builds connect URL with encoded params", () => {
    expect(
      buildConnectUrl({
        server: "https://tzrea1.com",
        code: "840021"
      })
    ).toBe("wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=840021");
  });

  it("parses connect URL", () => {
    expect(parseConnectUrl("wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=840021")).toEqual({
      server: "https://tzrea1.com",
      code: "840021"
    });
  });
});
