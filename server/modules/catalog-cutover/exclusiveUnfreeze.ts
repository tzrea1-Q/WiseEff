import { fail, ok } from "./checkpoints";
import type { CutoverResult } from "./interface";

export type ExclusiveUnfreezePorts = {
  readonly isFrozen: () => Promise<boolean>;
  readonly freeze: () => Promise<void>;
  readonly unfreeze: () => Promise<void>;
};

export type ExclusiveUnfreezeInput = {
  readonly ports: ExclusiveUnfreezePorts;
  readonly exclusiveToken: string;
  readonly expectedToken: string;
  readonly activate: () => Promise<{ readonly receipt: string } | { readonly error: string }>;
};

export type ExclusiveUnfreezeOutcome = {
  readonly frozenBefore: true;
  readonly frozenAfter: true;
  readonly activationReceipt: string | null;
  readonly activateOk: boolean;
};

const TOKEN = /^[A-Za-z0-9._-]{16,}$/;

export const exclusivePublicationUnfreeze = async (
  input: ExclusiveUnfreezeInput,
): Promise<CutoverResult<ExclusiveUnfreezeOutcome>> => {
  if (!TOKEN.test(input.exclusiveToken) || input.exclusiveToken !== input.expectedToken) {
    return fail(
      "PCAT-ORC-INVALID-TOKEN",
      "Publication unfreeze requires the exclusive authorized token",
    );
  }
  const frozenBefore = await input.ports.isFrozen();
  if (!frozenBefore) {
    return fail("PCAT-ORC-PHASE-FAILED", "Publication unfreeze requires freeze to already be set");
  }
  let activateOk = false;
  let activationReceipt: string | null = null;
  let activateError: string | null = null;
  try {
    await input.ports.unfreeze();
    const activated = await input.activate();
    if ("error" in activated) {
      activateError = activated.error;
    } else if (!activated.receipt.trim()) {
      activateError = "Activation receipt is missing after exclusive unfreeze";
    } else {
      activateOk = true;
      activationReceipt = activated.receipt;
    }
  } finally {
    await input.ports.freeze();
  }
  const frozenAfter = await input.ports.isFrozen();
  if (!frozenAfter) {
    return fail("PCAT-ORC-PHASE-FAILED", "Publication freeze was not restored after exclusive unfreeze");
  }
  if (activateError) {
    return fail("PCAT-ORC-PHASE-FAILED", activateError);
  }
  return ok({
    frozenBefore: true,
    frozenAfter: true,
    activationReceipt,
    activateOk,
  });
};
