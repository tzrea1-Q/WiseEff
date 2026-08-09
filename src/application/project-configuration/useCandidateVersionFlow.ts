import { useMemo, useSyncExternalStore } from "react";

import {
  createCandidateVersionFlow,
  type CandidateVersionFlow,
  type CandidateVersionFlowSnapshot
} from "./candidateVersionFlow";

export type UseCandidateVersionFlowResult = CandidateVersionFlowSnapshot & {
  flow: CandidateVersionFlow;
};

/** React adapter over {@link createCandidateVersionFlow}. Prefer testing the flow command interface. */
export function useCandidateVersionFlow(): UseCandidateVersionFlowResult {
  const flow = useMemo(() => createCandidateVersionFlow(), []);
  const snapshot = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  return { flow, ...snapshot };
}
