import { createContext, useContext } from "react";

export type XiaozePageContextInput = {
  path: string;
  pageKey: string;
  projectId?: string;
  projectName?: string;
  roleId?: string;
  visibleRecords?: unknown[];
};

export const XiaozePageContext = createContext<XiaozePageContextInput | null>(null);

export function useXiaozePageContextValue() {
  return useContext(XiaozePageContext);
}
