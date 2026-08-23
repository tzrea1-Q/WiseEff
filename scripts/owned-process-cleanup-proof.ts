import { createServer } from "node:net";

import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

export type OwnedProcessCleanupClassification = "owned" | "absent";

export async function classifyOwnedProcessForCleanup(input: {
  label: string;
  pid: number;
  expectedIdentity: ProcessStartIdentity & { pid: number; port: number };
  readProcessIdentity?: (pid: number) => ProcessStartIdentity | undefined;
  pidExists?: (pid: number) => boolean;
  portIsUnused?: (port: number) => Promise<boolean>;
}): Promise<OwnedProcessCleanupClassification> {
  if (input.expectedIdentity.pid !== input.pid) {
    throw new Error(`${input.label} process identity is missing or does not match PID ${input.pid}; refusing signal.`);
  }

  const currentIdentity = (input.readProcessIdentity ?? readProcessStartIdentity)(input.pid);
  if (currentIdentity) {
    if (!sameProcessStartIdentity(input.expectedIdentity, currentIdentity)) {
      throw new Error(`${input.label} process identity changed for PID ${input.pid}; refusing signal.`);
    }
    return "owned";
  }

  const pidAbsent = !(input.pidExists ?? processPidExists)(input.pid);
  const portUnused = pidAbsent && await (input.portIsUnused ?? isLoopbackPortUnused)(input.expectedIdentity.port);
  if (pidAbsent && portUnused) return "absent";

  throw new Error(
    `${input.label} PID ${input.pid} absence could not be proven with port ${input.expectedIdentity.port} unused; refusing cleanup.`,
  );
}

function processPidExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function isLoopbackPortUnused(port: number) {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) return false;
  const server = createServer();
  return new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
