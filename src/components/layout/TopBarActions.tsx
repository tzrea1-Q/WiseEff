import { createContext, useContext, useEffect } from "react";
import type { DependencyList, Dispatch, ReactNode, SetStateAction } from "react";

export type TopBarActionsContextValue = {
  setActions: Dispatch<SetStateAction<ReactNode | null>>;
  setLeadingActions: Dispatch<SetStateAction<ReactNode | null>>;
};

export const TopBarActionsContext = createContext<TopBarActionsContextValue | null>(null);

export function useTopBarActions(actions: ReactNode, deps: DependencyList) {
  const context = useContext(TopBarActionsContext);

  useEffect(() => {
    if (!context) {
      return undefined;
    }

    context.setActions(actions);
    return () => context.setActions(null);
  }, [context, ...deps]);
}

export function useTopBarLeadingActions(actions: ReactNode, deps: DependencyList) {
  const context = useContext(TopBarActionsContext);

  useEffect(() => {
    if (!context) {
      return undefined;
    }

    context.setLeadingActions(actions);
    return () => context.setLeadingActions(null);
  }, [context, ...deps]);
}
