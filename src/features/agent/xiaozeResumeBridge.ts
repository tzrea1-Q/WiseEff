import type { ResumeEntry } from "@ag-ui/core";

export type CopilotKitInterruptEvent = {
  approvalId?: string;
  toolCallId?: string;
  toolName?: string;
  payload?: Record<string, unknown>;
  citations?: unknown[];
};

export type CopilotKitResumeCommand = {
  resume?: {
    decision?: string;
    editedArgs?: Record<string, unknown>;
    reason?: string;
  };
  interruptEvent?: CopilotKitInterruptEvent;
};

/**
 * CopilotKit `useInterrupt` resolve() sends `forwardedProps.command` only.
 * AG-UI HttpAgent requires top-level `resume[]` with `interruptId` matching pending interrupts.
 */
export function buildXiaozeResumeEntries(command: CopilotKitResumeCommand | undefined): ResumeEntry[] | undefined {
  const decision = command?.resume?.decision;
  const approvalId = command?.interruptEvent?.approvalId;
  if (!approvalId || (decision !== "approve" && decision !== "reject")) {
    return undefined;
  }

  return [
    {
      interruptId: approvalId,
      status: decision === "reject" ? "cancelled" : "resolved",
      payload: {
        approvalId,
        decision,
        editedArgs: command.resume?.editedArgs,
        reason: command.resume?.reason
      }
    }
  ];
}

export function readCopilotKitResumeCommand(forwardedProps: unknown): CopilotKitResumeCommand | undefined {
  if (!forwardedProps || typeof forwardedProps !== "object") {
    return undefined;
  }
  const command = (forwardedProps as { command?: CopilotKitResumeCommand }).command;
  return command && typeof command === "object" ? command : undefined;
}
