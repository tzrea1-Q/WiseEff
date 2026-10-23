export function getContextQuery(search: string) {
  const params = new URLSearchParams(search);
  return {
    projectId: params.get("project") ?? params.get("projectId") ?? "",
    module: params.get("module") ?? "",
    parameterId: params.get("parameter") ?? "",
    bindingId: params.get("bindingId") ?? params.get("binding") ?? "",
    logId: params.get("logId") ?? ""
  };
}
