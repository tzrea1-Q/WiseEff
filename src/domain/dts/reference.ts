export class DtsPathReferenceError extends SyntaxError {
  sourceName?:string;
  constructor(message:string,readonly offset=0){super(message);}
}

/** Labels stay unchanged; native path references retain braces so existing &target writers round-trip. */
export function dtsReferencePath(reference:string):string|null {
  if(!reference.startsWith("{"))return null;
  const path=reference.slice(1,-1);
  if(!reference.endsWith("}") || !/^\/(?:[A-Za-z0-9,._+@#-]+(?:\/[A-Za-z0-9,._+@#-]+)*)?$/u.test(path)
    || path.split("/").some(part=>part==="." || part==="..")) throw new DtsPathReferenceError(`Invalid DTS node-path reference &${reference}`);
  return path;
}
