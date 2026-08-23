import { describe, expect, it } from "vitest";

import {
  registerGate0GeneratedSecrets,
  startGate0SecretRegistry,
} from "./gate0-secret-registry";

describe("Gate0 in-memory secret registry", () => {
  it("does not outlive an owner cancellation during startup", async () => {
    const owner = new AbortController();
    owner.abort(new Error("owner deadline elapsed"));

    await expect(startGate0SecretRegistry(owner.signal)).rejects.toThrow(/deadline elapsed/i);
  });

  it("collects root and nested generated values without writing them to a manifest", async () => {
    const registry = await startGate0SecretRegistry();
    const rootSecret = "a".repeat(64);
    const rootBearer = "Bearer root-owned-token-value";
    const nestedSecret = "b".repeat(64);
    const nestedBearer = "Bearer nested-owned-token-value";

    try {
      registry.add([rootSecret, rootBearer]);
      await registerGate0GeneratedSecrets([nestedSecret, nestedBearer], registry.env);

      expect(registry.values()).toEqual(
        expect.arrayContaining([rootSecret, rootBearer, nestedSecret, nestedBearer]),
      );
      expect(JSON.stringify(registry.env)).not.toContain(rootSecret);
      expect(JSON.stringify(registry.env)).not.toContain(nestedSecret);
    } finally {
      await registry.close();
    }
  });
});
