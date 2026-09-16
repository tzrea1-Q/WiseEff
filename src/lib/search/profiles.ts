import type { DebugParameter, DebugParameterNodeBinding, DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import type { LogRecord } from "@/domain/logs/types";
import type { ParameterRecord } from "@/domain/parameters/types";
import type { ComparisonRow } from "@/domain/parameters/comparison";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import type { UserAccount } from "@/domain/users/types";
import type { TreeFilterNode } from "@/domain/tree-filter/treeFilter";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";
import type { DebugParameterLibraryRow } from "@/debugAdminLibraryFilters";
import type { SpecAttributionModule } from "@/domain/parameter-topology/types";
import { FIELD_WEIGHT, type SearchProfile } from "./types";
import { treeFilterNodePath } from "@/domain/tree-filter/treeFilter";

type SpecLibrarySearchRow = {
  propertyKey: string;
  driverModule: string | null;
  compatible: string | null;
  schemaSource: string;
  valueType: string;
  attributionModules: SpecAttributionModule[];
  declaredPlacement?: {
    moduleName: string;
    path?: string[];
  } | null;
};

export { FIELD_WEIGHT };

export const parameterRecordSearchProfile: SearchProfile<ParameterRecord> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "explanation", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.explanation] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] },
    { name: "modulePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.modulePath] },
    { name: "configFormat", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.configFormat] },
    { name: "sourceFileName", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.sourceFileName] },
    { name: "sourceNodePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.sourceNodePath] }
  ]
};

export const debugParameterSearchProfile: SearchProfile<
  Pick<DebugParameter, "name" | "key" | "description" | "module" | "modulePath" | "nodePath" | "bindings">
> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "key", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.key] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] },
    { name: "modulePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.modulePath] },
    { name: "nodePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.nodePath] },
    {
      name: "bindingPath",
      weight: FIELD_WEIGHT.attribution,
      getValues: (item) => (item.bindings ?? []).map((binding: DebugParameterNodeBinding) => binding.nodePath)
    }
  ]
};

export const debugParameterLibrarySearchProfile: SearchProfile<DebugParameterLibraryRow> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "key", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.key] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] }
  ]
};

export const debugNodeSearchProfile: SearchProfile<DebugNodeRegistryEntry> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "explanation", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.detailedDescription] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] },
    { name: "modulePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.modulePath] },
    { name: "nodePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => item.bindings.map((binding) => binding.nodePath) }
  ]
};

export const userAccountSearchProfile: SearchProfile<UserAccount> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "username", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.username] },
    { name: "email", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.email] },
    { name: "title", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.title] }
  ]
};

export const logAdminRecordSearchProfile: SearchProfile<LogRecord> = {
  fields: [
    { name: "reportId", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.reportId] },
    { name: "fileName", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.fileName] },
    { name: "source", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.source] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.conclusion, item.analysisQuestion] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.logDomainName] }
  ]
};

export const knowledgeTitleSearchProfile: SearchProfile<Pick<KnowledgeEntry, "title" | "tags">> = {
  fields: [
    { name: "title", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.title] },
    { name: "notes", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.tags] }
  ]
};

export const parameterSpecLibrarySearchProfile: SearchProfile<SpecLibrarySearchRow> = {
  fields: [
    { name: "propertyKey", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.propertyKey] },
    {
      name: "module",
      weight: FIELD_WEIGHT.attribution,
      getValues: (item) => [
        item.declaredPlacement?.moduleName,
        item.declaredPlacement?.path,
        ...item.attributionModules.map((module) => module.name)
      ]
    },
    { name: "compatible", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.compatible, item.driverModule] },
    { name: "configFormat", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.schemaSource, item.valueType] }
  ]
};

export const specReviewTaskSearchProfile: SearchProfile<{ propertyKey: string; nodeName?: string | null; driverModule?: string | null }> = {
  fields: [
    { name: "propertyKey", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.propertyKey] },
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.nodeName] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.driverModule] }
  ]
};

export const specReviewLibraryItemSearchProfile: SearchProfile<{
  label: string;
  propertyKey?: string | null;
  driverModule?: string | null;
}> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.label] },
    { name: "propertyKey", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.propertyKey] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.driverModule] }
  ]
};

export const projectAdminSearchProfile: SearchProfile<Pick<ParameterAdminProjectRow, "id" | "name" | "code">> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "key", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.code, item.id] }
  ]
};

export const productFeedbackSearchProfile: SearchProfile<ProductFeedback> = {
  fields: [
    { name: "title", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.pageTitle] },
    { name: "path", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.pagePath] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.submitterUserId] }
  ]
};

export const dtsReloadCandidateSearchProfile: SearchProfile<DtsReloadCandidate> = {
  fields: [
    { name: "displayName", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.displayName] },
    { name: "propertyKey", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.propertyKey] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] },
    { name: "nodePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.nodePath] },
    { name: "compatible", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.compatible] }
  ]
};

export const treeFilterNodeSearchProfile: SearchProfile<TreeFilterNode> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.label] },
    { name: "path", weight: FIELD_WEIGHT.attribution, getValues: (item) => [treeFilterNodePath(item)] }
  ]
};

export const moduleNodeSearchProfile: SearchProfile<Pick<FlatModuleNode, "name" | "description" | "scope" | "path">> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "path", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.path, item.scope] }
  ]
};

export const dtsNodePathSearchProfile: SearchProfile<{ nodePath: string }> = {
  fields: [{ name: "path", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.nodePath] }]
};

export const projectBindingSearchProfile: SearchProfile<ProjectParameterBinding> = {
  fields: [
    { name: "propertyKey", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.propertyKey] },
    { name: "displayName", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.displayName] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "documentation", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.documentation] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.driverModule, item.instanceName] },
    { name: "path", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.locator] },
    { name: "value", weight: FIELD_WEIGHT.value, getValues: (item) => [item.rawValue] }
  ]
};

export const dtsWorkbenchRowSearchProfile: SearchProfile<DtsParameterWorkbenchRow> = {
  fields: [
    { name: "propertyKey", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.propertyKey] },
    { name: "displayName", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.displayName] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "documentation", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.documentation] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.moduleName] },
    { name: "modulePath", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.modulePath] },
    {
      name: "compatible",
      weight: FIELD_WEIGHT.attribution,
      getValues: (item) => [item.driverModule, item.compatible, item.instanceName]
    },
    {
      name: "path",
      weight: FIELD_WEIGHT.attribution,
      getValues: (item) => [item.topologyPath, item.sourceNodePath, item.sourceFileName, item.unitAddress]
    },
    { name: "value", weight: FIELD_WEIGHT.value, getValues: (item) => [item.rawValue, item.valueShapeSummary] }
  ]
};

export const comparisonRowSearchProfile: SearchProfile<ComparisonRow> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.key] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] },
    { name: "value", weight: FIELD_WEIGHT.value, getValues: (item) => [item.baseValue, item.targetValue] }
  ]
};

export const auditEventSearchProfile: SearchProfile<{
  action: string;
  actor: string;
  kind: string;
  app: string;
  targetId?: string | null;
  traceId?: string | null;
}> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.action, item.actor, item.kind] },
    { name: "path", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.app, item.targetId, item.traceId] }
  ]
};
