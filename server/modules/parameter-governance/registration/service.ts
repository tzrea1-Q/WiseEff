import type pg from "pg";

import type { RegistrationCommand } from "./command";
import { validateRegistrationCommand } from "./command";
import type { RegistrationFailure } from "./failures";
import { mapWriterDatabaseError } from "./failures";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import type { RegistrationResult, Result } from "./result";
import { withRegistrationUnitOfWork } from "./unitOfWork";

export type RegistrationService = {
  execute(
    command: RegistrationCommand,
  ): Promise<Result<RegistrationResult, RegistrationFailure>>;
};

export const executeRegistration = async (
  pool: pg.Pool,
  command: RegistrationCommand,
): Promise<Result<RegistrationResult, RegistrationFailure>> => {
  const validated = validateRegistrationCommand(command);
  if (!validated.ok) return validated;
  try {
    return await withRegistrationUnitOfWork(pool, (client) =>
      writeGuardedRegistration(client, validated.value),
    );
  } catch (error) {
    const subjectId =
      command.kind === "register" ? command.subjectId : command.registrationId;
    const mapped = mapWriterDatabaseError(error, command.expectedRelease, subjectId);
    if (mapped) return { ok: false, error: mapped };
    throw error;
  }
};

export const createRegistrationService = (pool: pg.Pool): RegistrationService => ({
  execute: (command) => executeRegistration(pool, command),
});
