declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;

  export const promises: {
    writeFile(path: string, data: string, encoding: string): Promise<void>;
  };
}

declare module "node:path" {
  const path: {
    resolve(...paths: string[]): string;
  };
  export default path;
}
