import type { BatchRegistrationEntry } from "./BatchRegistrationTable";

const eventName = "wiseeff:batch-registration-handoff";
type Handoff = BatchRegistrationEntry & { organizationId: string; userId: string };
let pending: Handoff | undefined;

export function openBatchRegistration(handoff: Handoff) {
  pending = handoff;
  window.dispatchEvent(new Event(eventName));
}

export function takeBatchRegistrationHandoff(organizationId: string, userId: string): BatchRegistrationEntry | undefined {
  if (pending?.organizationId !== organizationId || pending.userId !== userId) return undefined;
  const { subjectIds, hints } = pending;
  pending = undefined;
  return { subjectIds, hints };
}

export function onBatchRegistrationHandoff(listener: () => void) {
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
