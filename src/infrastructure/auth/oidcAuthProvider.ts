export type OidcAuthProviderOptions = {
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  refresh?: () => void | Promise<void>;
  logout?: () => void | Promise<void>;
};

export type BrowserOidcRuntime = OidcAuthProviderOptions;

export type BrowserOidcWindow = {
  wiseEffOidc?: BrowserOidcRuntime;
};

export function createOidcAuthProvider({ getAccessToken, refresh, logout }: OidcAuthProviderOptions) {
  return {
    async getAuthorization() {
      try {
        await refresh?.();
      } catch (error) {
        await logout?.();
        throw error;
      }

      const accessToken = await getAccessToken();
      return accessToken?.trim() ? `Bearer ${accessToken}` : undefined;
    },
    logout: () => logout?.()
  };
}

function defaultOidcWindow(): BrowserOidcWindow {
  return window as Window & typeof globalThis & BrowserOidcWindow;
}

export function createDefaultOidcAuthProvider(oidcWindow: BrowserOidcWindow = defaultOidcWindow()) {
  const runtime = oidcWindow.wiseEffOidc;
  if (!runtime) {
    return undefined;
  }

  return createOidcAuthProvider(runtime);
}
