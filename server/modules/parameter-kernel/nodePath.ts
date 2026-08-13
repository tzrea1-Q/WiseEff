/** Resolve dts_nodes.node_path from a parsed_index-style `nodePath/prop` source path. */
export function nodePathFromSourceNodePath(sourceNodePath: string): string {
  const slash = sourceNodePath.lastIndexOf("/");
  if (slash <= 0) {
    return sourceNodePath;
  }
  return sourceNodePath.slice(0, slash);
}
