import { useMemo } from "react";
import { useAgentContext, type JsonSerializable } from "@copilotkit/react-core/v2";
import { xiaozeProactiveEnabled } from "@/infrastructure/http/runtimeMode";
import { XiaozeProactiveInsights } from "./XiaozeProvider";
import { XiaozePageContext, type XiaozePageContextInput } from "./xiaozePageContext";

export type { XiaozePageContextInput } from "./xiaozePageContext";
export { useXiaozePageContextValue, XiaozePageContext } from "./xiaozePageContext";

function toPageContextValue(input: XiaozePageContextInput): JsonSerializable {
  return {
    path: input.path,
    pageKey: input.pageKey,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.roleId ? { roleId: input.roleId } : {}),
    ...(input.visibleRecords?.length ? { visibleRecords: input.visibleRecords as JsonSerializable[] } : {})
  };
}

export function XiaozePageContextRegistrar(input: XiaozePageContextInput) {
  const value = useMemo(() => input, [input.path, input.pageKey, input.projectId, input.roleId, input.visibleRecords]);

  useAgentContext({
    description: "wiseeff.page",
    value: toPageContextValue(value)
  });

  return (
    <XiaozePageContext.Provider value={value}>
      <XiaozeProactiveInsights enabled={xiaozeProactiveEnabled} />
    </XiaozePageContext.Provider>
  );
}
