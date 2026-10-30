import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { withBusinessOrganizationScope } from "@/infrastructure/http/organizationScope";
import { dispatchDefinitionImportHandoff } from "./definitionImportHandoff";

function navigateToPath(path: string) {
  const url = new URL(path, window.location.origin);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

/**
 * Frontend tools must produce user-visible effects. The former
 * `prefillParameterValue` tool wrote to a registry no page consumed, so the
 * agent claimed "已预填" while the UI never changed — it has been removed.
 */
export function useXiaozeFrontendTools(organizationId?: string, permissions?: readonly string[] | null, userId?: string, notify?: (message: string) => void, homeOrganizationId?: string) {
  useFrontendTool({
    name: "navigateTo",
    description: "Navigate the user to a WiseEff page path without performing any write.",
    parameters: z.object({
      path: z.string()
    }),
    handler: async ({ path }) => {
      const destination = withBusinessOrganizationScope(path, organizationId);
      navigateToPath(destination);
      return { navigatedTo: destination };
    }
  }, [organizationId]);
  useFrontendTool({
    name: "openDefinitionImport",
    description: "Hand a prepared Markdown document to the human in the definition import dialog. Never previews or publishes.",
    parameters: z.object({ document: z.string().min(1).max(1_048_576) }),
    followUp: false,
    handler: async ({ document }) => {
      const targetOrganizationId = organizationId ?? homeOrganizationId;
      if (!permissions?.includes("catalog:author") || !targetOrganizationId || !userId) {
        const message = "无法打开批量导入定义：需要当前组织的 catalog:author 权限。";
        notify?.(message);
        return { message };
      }
      dispatchDefinitionImportHandoff({ document, organizationId: targetOrganizationId, userId });
      navigateToPath(withBusinessOrganizationScope("/parameter-admin/specs", organizationId));
      return { message: "已移交文档，请在目录中检查后自行预览和发布。" };
    }
  }, [organizationId, userId, permissions, homeOrganizationId]);
}
