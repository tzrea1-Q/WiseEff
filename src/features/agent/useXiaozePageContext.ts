import { useMemo } from "react";
import { useAgentContext, type JsonSerializable } from "@copilotkit/react-core/v2";

export type XiaozePageContextInput = {
  path: string;
  pageKey: string;
  projectId?: string;
  roleId?: string;
  visibleRecords?: JsonSerializable[];
};

function toPageContextValue(input: XiaozePageContextInput): JsonSerializable {
  return {
    path: input.path,
    pageKey: input.pageKey,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.roleId ? { roleId: input.roleId } : {}),
    ...(input.visibleRecords?.length ? { visibleRecords: input.visibleRecords } : {})
  };
}

export function XiaozePageContextRegistrar(input: XiaozePageContextInput) {
  const value = useMemo(() => toPageContextValue(input), [input]);

  useAgentContext({
    description: "wiseeff.page",
    value
  });

  return null;
}
