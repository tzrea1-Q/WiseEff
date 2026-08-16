/**
 * Text-log extensions shared by the mock runtime and the /logs upload precheck.
 * Keep in lockstep with `supportedLogExtensions` in `server/modules/logs/status.ts`.
 * Archives (.gz / .zip) stay API-only because only the server unpacks them.
 */
export const supportedTextLogExtensions = ["log", "txt", "csv", "json"] as const;
export const supportedLogArchiveExtensions = ["gz", "zip"] as const;

const textExtensionSet = new Set<string>(supportedTextLogExtensions);
const archiveExtensionSet = new Set<string>(supportedLogArchiveExtensions);

function fileExtension(fileName: string): string | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension && extension !== fileName.toLowerCase() ? extension : undefined;
}

export function isSupportedTextLogFileName(fileName: string): boolean {
  const extension = fileExtension(fileName);
  return extension ? textExtensionSet.has(extension) : false;
}

export function isSupportedLogUploadFileName(fileName: string, archivesSupported = false): boolean {
  const extension = fileExtension(fileName);
  if (!extension) {
    return false;
  }
  if (textExtensionSet.has(extension)) {
    return true;
  }
  return archivesSupported && archiveExtensionSet.has(extension);
}

export const mockLogUploadAccept = `.${supportedTextLogExtensions.join(",.")}`;
