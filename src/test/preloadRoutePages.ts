/**
 * Route pages are `React.lazy` chunks (src/app/routes.tsx, src/App.tsx). The first dynamic import of a large page can
 * take longer than Testing Library's default wait on a loaded CI runner, so suites that render the whole
 * app warm the module cache once before their tests run.
 */
export async function preloadRoutePages() {
  await Promise.all([
    import("@/AuditCenterPage"),
    import("@/linear-template/LinearTemplateHome"),
    import("@/features/log-analysis/LogsPage"),
    import("@/features/parameter-review/ParameterChangesPage"),
    import("@/LogAdminPage"),
    import("@/features/log-skills/SkillWorkspace"),
    import("@/NodeDebuggingPage"),
    import("@/ParameterAdminNextPage"),
    import("@/features/parameter-home/ParameterHomePage"),
    import("@/features/product-feedback/FeedbackAdminPage"),
    import("@/features/product-feedback/FeedbackCenterPage"),
    import("@/features/knowledge/KnowledgeAdminPage"),
    import("@/features/knowledge/KnowledgePage"),
    import("@/features/dts-reload/DtsReloadPage"),
    import("@/ParametersPage"),
    import("@/OrganizationPage"),
    import("@/features/organization/OrganizationWorkspace"),
    import("@/features/parameter-catalog/CatalogPage"),
    import("@/features/workflow-publication/WorkflowPublicationPage"),
    import("@/features/organization/PlatformOrganizationsPage"),
    import("@/DebuggingAdminPage"),
    import("@/features/organization/InvitationAcceptancePage")
  ]);
}
