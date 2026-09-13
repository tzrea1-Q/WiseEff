export type PublicationManagerDatabaseUrlError = {
  readonly code: "manager-dsn-missing" | "manager-dsn-reuses-api" | "manager-dsn-invalid";
  readonly message: string;
};

export type PublicationManagerDatabaseUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: PublicationManagerDatabaseUrlError };

const loginName = (raw: string): string | null => {
  try {
    return decodeURIComponent(new URL(raw).username);
  } catch {
    return null;
  }
};

export function publicationManagerDatabaseUrlReusesApiLogin(
  managerUrl: string,
  apiUrl: string,
): boolean {
  const managerLogin = loginName(managerUrl);
  const apiLogin = loginName(apiUrl);
  if (!managerLogin || !apiLogin) {
    return managerUrl.trim() === apiUrl.trim();
  }
  return managerLogin === apiLogin;
}

export function resolvePublicationManagerDatabaseUrl(
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
): PublicationManagerDatabaseUrlResult {
  const managerUrl = env.WISEEFF_PUBLICATION_MANAGER_DATABASE_URL?.trim() ?? "";
  const apiUrl = env.DATABASE_URL?.trim() ?? "";
  if (!managerUrl) {
    return {
      ok: false,
      error: {
        code: "manager-dsn-missing",
        message:
          "WISEEFF_PUBLICATION_MANAGER_DATABASE_URL is required. Do not reuse DATABASE_URL. Provision a dedicated manager LOGIN.",
      },
    };
  }
  try {
    // eslint-disable-next-line no-new
    new URL(managerUrl);
  } catch {
    return {
      ok: false,
      error: {
        code: "manager-dsn-invalid",
        message: "WISEEFF_PUBLICATION_MANAGER_DATABASE_URL is not a valid URL",
      },
    };
  }
  if (apiUrl && publicationManagerDatabaseUrlReusesApiLogin(managerUrl, apiUrl)) {
    return {
      ok: false,
      error: {
        code: "manager-dsn-reuses-api",
        message:
          "WISEEFF_PUBLICATION_MANAGER_DATABASE_URL must not reuse the API DATABASE_URL login",
      },
    };
  }
  return { ok: true, url: managerUrl };
}
