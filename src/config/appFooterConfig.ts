import packageMetadata from "../../package.json";

export type AppFooterContact = {
  href: string;
  kind: "https" | "mailto";
};

export type AppFooterConfig = {
  contact: AppFooterContact | null;
  copyrightOwner: string;
  version: string;
};

export type AppFooterEnv = {
  VITE_WISEEFF_APP_VERSION?: string;
  VITE_WISEEFF_CONTACT_HREF?: string;
  VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER?: string;
};

type AppFooterConfigDiagnostics = {
  development?: boolean;
  warn?: (message: string) => void;
};

function resolveContact(configuredHref: string | undefined): AppFooterContact | null {
  const href = configuredHref?.trim();
  if (!href) return null;

  try {
    const parsed = new URL(href);
    if (parsed.protocol === "https:" && parsed.hostname) {
      return { href, kind: "https" };
    }
    if (parsed.protocol === "mailto:" && parsed.pathname) {
      return { href, kind: "mailto" };
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveAppFooterConfig(
  env: AppFooterEnv,
  packageVersion: string,
  diagnostics: AppFooterConfigDiagnostics = {}
): AppFooterConfig {
  const configuredOwner = env.VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER?.trim();
  const configuredVersion = env.VITE_WISEEFF_APP_VERSION?.trim();
  const configuredContact = env.VITE_WISEEFF_CONTACT_HREF?.trim();
  const contact = resolveContact(configuredContact);
  const version = configuredVersion || packageVersion;
  const normalizedVersion = version.replace(/^v+/iu, "");

  if (configuredContact && !contact && diagnostics.development) {
    diagnostics.warn?.(
      "VITE_WISEEFF_CONTACT_HREF must use https: or mailto:; the footer contact link is hidden."
    );
  }

  return {
    contact,
    copyrightOwner: configuredOwner || "雷泽（WiseEff）",
    version: `v${normalizedVersion}`
  };
}

export const appFooterConfig = resolveAppFooterConfig(import.meta.env, packageMetadata.version, {
  development: import.meta.env.DEV,
  warn: (message) => console.warn(message)
});
