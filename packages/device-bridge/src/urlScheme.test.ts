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

  it("accepts local http server URLs", () => {
    expect(
      parseConnectUrl("wiseeff-bridge://connect?server=http%3A%2F%2F127.0.0.1%3A8787&code=123456")
    ).toEqual({
      server: "http://127.0.0.1:8787",
      code: "123456"
    });
  });

  it("rejects non-http(s) server URLs", () => {
    expect(() =>
      parseConnectUrl("wiseeff-bridge://connect?server=ftp%3A%2F%2Fwiseeff.example.com&code=123456")
    ).toThrow("Server URL must use https or local http");
  });

  it("rejects remote http server URLs", () => {
    expect(() =>
      parseConnectUrl("wiseeff-bridge://connect?server=http%3A%2F%2Fwiseeff.example.com&code=123456")
    ).toThrow("Server URL must use https or local http");
  });

  it("rejects invalid pairing codes", () => {
    expect(() =>
      parseConnectUrl("wiseeff-bridge://connect?server=https%3A%2F%2Ftzrea1.com&code=abc")
    ).toThrow("Pairing code must be a 6-digit number");
  });
});
