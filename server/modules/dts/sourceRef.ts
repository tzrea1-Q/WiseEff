/**
 * Source-location syntax shared by the capabilities that rewrite DTS sources
 * (property-key cutover, definition identity correction) and by the consumer
 * that records canonical project values.
 *
 * A source reference names the project file the value came from, optionally
 * followed by `!` and a location inside it (for example a node locator).  The
 * property key is never part of the location: coupling is defined over the file
 * plus node, and the key is tracked separately on the binding.
 */
const DTS_SOURCE_PATTERN = /\.dts(?:$|[?#])/u;

/** The file portion of a source reference, dropping any `!`-suffixed locator. */
export const sourcePathOf = (sourceRef: string): string =>
  sourceRef.split("!")[0] ?? sourceRef;

/** Only `.dts` sources are rewritten; every other format is unsupported. */
export const isDtsSourceRef = (sourceRef: string): boolean =>
  DTS_SOURCE_PATTERN.test(sourcePathOf(sourceRef));

/** Build the canonical source reference for a project DTS file and locator. */
export const deriveDtsSourceRef = (input: {
  readonly fileName: string;
  readonly nodeLocator: string | null;
}): string => {
  const locator = input.nodeLocator?.trim() ?? "";
  return locator.length > 0 ? `${input.fileName}!${locator}` : input.fileName;
};
