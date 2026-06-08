import { createDefaultOidcAuthProvider, type BrowserOidcWindow } from "@/infrastructure/auth/oidcAuthProvider";
import { createApiClient } from "./apiClient";
import { wiseEffApiAuthorization, wiseEffApiBaseUrl } from "./runtimeMode";

export type DefaultApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  oidcWindow?: BrowserOidcWindow;
};

export function createDefaultApiClient(options: DefaultApiClientOptions = {}) {
  const oidcProvider = createDefaultOidcAuthProvider(options.oidcWindow);
  return createApiClient({
    baseUrl: options.baseUrl ?? wiseEffApiBaseUrl,
    authorization: wiseEffApiAuthorization,
    getAuthorization: oidcProvider?.getAuthorization,
    onAuthorizationFailure: oidcProvider?.logout,
    fetchImpl: options.fetchImpl ?? fetch
  });
}
