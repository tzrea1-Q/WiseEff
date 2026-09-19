import { describe, expect, it } from "vitest";

import { exclusivePublicationUnfreeze } from "./exclusiveUnfreeze";

const token = "exclusive-unfreeze-token";

const ports = (state: { frozen: boolean }) => ({
  isFrozen: async () => state.frozen,
  freeze: async () => {
    state.frozen = true;
  },
  unfreeze: async () => {
    state.frozen = false;
  },
});

describe("exclusive publication unfreeze", () => {
  it("refuses without freeze or exclusive token and refreezes on success and failure", async () => {
    const unfrozen = { frozen: false };
    const notFrozen = await exclusivePublicationUnfreeze({
      ports: ports(unfrozen),
      exclusiveToken: token,
      expectedToken: token,
      activate: async () => ({ receipt: "receipt-1" }),
    });
    expect(notFrozen.ok).toBe(false);

    const wrongToken = await exclusivePublicationUnfreeze({
      ports: ports({ frozen: true }),
      exclusiveToken: "wrong-token-value",
      expectedToken: token,
      activate: async () => ({ receipt: "receipt-1" }),
    });
    expect(wrongToken.ok).toBe(false);

    const state = { frozen: true };
    const failed = await exclusivePublicationUnfreeze({
      ports: ports(state),
      exclusiveToken: token,
      expectedToken: token,
      activate: async () => ({ error: "installer rejected" }),
    });
    expect(failed.ok).toBe(false);
    expect(state.frozen).toBe(true);

    const successState = { frozen: true };
    const succeeded = await exclusivePublicationUnfreeze({
      ports: ports(successState),
      exclusiveToken: token,
      expectedToken: token,
      activate: async () => ({ receipt: "activation-receipt-9" }),
    });
    expect(succeeded.ok).toBe(true);
    if (!succeeded.ok) return;
    expect(succeeded.value.activationReceipt).toBe("activation-receipt-9");
    expect(succeeded.value.frozenAfter).toBe(true);
    expect(successState.frozen).toBe(true);
  });
});
