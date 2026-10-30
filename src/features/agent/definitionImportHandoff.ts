const EVENT = "wiseeff:definition-import-handoff";
type Handoff = { organizationId: string; userId: string; document: string };
let pending: Handoff | undefined;

export function dispatchDefinitionImportHandoff(handoff: Handoff) {
  pending = handoff;
  window.dispatchEvent(new Event(EVENT));
}

export function takeDefinitionImportHandoff(organizationId: string, userId: string) {
  if (pending?.organizationId !== organizationId || pending.userId !== userId) return undefined;
  const handoff = pending;
  pending = undefined;
  return handoff.document;
}

export function onDefinitionImportHandoff(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
