import type pg from "pg";

import type { ProposalCommand } from "./command";
import { validateProposalCommand } from "./command";
import { writeRefusalAudit } from "./audit";
import type { ProposalFailure } from "./failures";
import { mapWriterDatabaseError } from "./failures";
import type { ProposalResult, Result } from "./result";
import { withProposalUnitOfWork } from "./unitOfWork";
import { writeProposal } from "./writer";

export type ProposalService = {
  execute(
    command: ProposalCommand,
  ): Promise<Result<ProposalResult, ProposalFailure>>;
};

export const executeProposal = async (
  pool: pg.Pool,
  command: ProposalCommand,
): Promise<Result<ProposalResult, ProposalFailure>> => {
  const validated = validateProposalCommand(command);
  if (!validated.ok) {
    await writeRefusalAudit(pool, command, validated.error);
    return validated;
  }
  try {
    const result = await withProposalUnitOfWork(pool, (client) =>
      writeProposal(client, validated.value),
    );
    if (!result.ok) {
      await writeRefusalAudit(pool, command, result.error);
    }
    return result;
  } catch (error) {
    const mapped = mapWriterDatabaseError(error);
    if (mapped) {
      await writeRefusalAudit(pool, command, mapped);
      return { ok: false, error: mapped };
    }
    throw error;
  }
};

export const createProposalService = (pool: pg.Pool): ProposalService => ({
  execute: (command) => executeProposal(pool, command),
});
