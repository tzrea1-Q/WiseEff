export function nodePathToParameterIdentity(nodePath: string): {
  name: string;
  module: string;
} {
  const segments = nodePath.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid node path: ${nodePath}`);
  }

  const name = segments[segments.length - 1]!;
  const module = segments.slice(0, -1).join("/");

  return { name, module };
}
