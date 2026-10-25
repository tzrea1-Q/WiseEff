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

/** A legacy label stub cannot prove its own absolute location or any descendant's location. */
export function dtsActualPathTarget<T extends {isLabelStub:boolean}>(nodes:ReadonlyMap<string,T>,path:string):T|undefined {
  const target=nodes.get(path);
  if(!target)return undefined;
  for(let ancestor=path;;) {
    if(nodes.get(ancestor)?.isLabelStub)return undefined;
    const slash=ancestor.lastIndexOf("/");
    if(slash<0)return target;
    ancestor=ancestor.slice(0,slash);
  }
}
