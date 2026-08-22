/**
 * Compatibility re-export. Mock seeding lives in
 * `src/infrastructure/mock/prototypeState.ts`; API boot lives in
 * `src/application/state/apiInitialState.ts`. Production `App.tsx` / `appState.ts`
 * should not import `createPrototypeState` or the projects catalog from here.
 */
export { createApiInitialState } from "./application/state/apiInitialState";
export { derivePowerManagementRuntimeState } from "./application/state/derivePowerManagementRuntimeState";
export {
  auditEvents,
  createPrototypeState,
  initialState,
  mockDataFingerprint,
  projects,
  roles,
  users
} from "./infrastructure/mock/prototypeState";
export { REVIEW_MOCK_NOW } from "./reviewMockData";
