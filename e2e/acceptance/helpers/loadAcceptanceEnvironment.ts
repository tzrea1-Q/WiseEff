import { loadAcceptanceEnvironment } from "./acceptanceEnvironment";

// This side-effect entrypoint must be the first acceptance-spec import so the
// environment contract is applied before dependencies evaluate.
loadAcceptanceEnvironment();
