import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import {
  createParameterAdminApplication,
  type ParameterAdminApplication,
  type ParameterAdminImportActions
} from "@/application/parameters/parameterAdminApplication";
import {
  initialParameterAdminState,
  parameterAdminReducer,
  type ParameterAdminAction,
  type ParameterAdminState
} from "@/application/parameters/parameterAdminState";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";

type ParameterAdminContextValue = {
  state: ParameterAdminState;
  dispatch: Dispatch<ParameterAdminAction>;
  application: ParameterAdminApplication;
};

const ParameterAdminContext = createContext<ParameterAdminContextValue | null>(null);

export type ParameterAdminProviderProps = {
  topology: ParameterTopologyRepository;
  moduleRegistry: ParameterModuleRegistryRepository;
  importActions?: ParameterAdminImportActions;
  dtsStructured?: DtsStructuredRepository;
  parameterFiles?: ParameterFileRepository;
  children: ReactNode;
  initialState?: ParameterAdminState;
};

export function ParameterAdminProvider({
  topology,
  moduleRegistry,
  importActions,
  dtsStructured,
  parameterFiles,
  children,
  initialState = initialParameterAdminState
}: ParameterAdminProviderProps) {
  const [state, dispatch] = useReducer(parameterAdminReducer, initialState);
  const application = useMemo(
    () =>
      createParameterAdminApplication({
        topology,
        moduleRegistry,
        importActions,
        dtsStructured,
        parameterFiles
      }),
    [topology, moduleRegistry, importActions, dtsStructured, parameterFiles]
  );
  const value = useMemo(() => ({ state, dispatch, application }), [state, application]);

  return <ParameterAdminContext.Provider value={value}>{children}</ParameterAdminContext.Provider>;
}

export function useParameterAdmin(): ParameterAdminContextValue {
  const value = useContext(ParameterAdminContext);
  if (!value) {
    throw new Error("useParameterAdmin must be used within ParameterAdminProvider");
  }
  return value;
}
