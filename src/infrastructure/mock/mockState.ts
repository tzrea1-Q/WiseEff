import { createPrototypeState, type PrototypeState } from "@/mockData";
export type MockRuntimeState = { current: PrototypeState };
export function createMockRuntimeState(initialState: PrototypeState = createPrototypeState()): MockRuntimeState { return { current: initialState }; }
export function readMockState(runtime: MockRuntimeState): PrototypeState { return runtime.current; }
export function writeMockState(runtime: MockRuntimeState, nextState: PrototypeState): PrototypeState { runtime.current = nextState; return runtime.current; }
