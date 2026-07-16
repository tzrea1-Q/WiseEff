declare module "js-yaml" {
  const yaml: {
    load(input: string, options?: unknown): unknown;
    dump(input: unknown, options?: unknown): string;
  };
  export default yaml;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;

  export const promises: {
    readFile(path: string, encoding: string): Promise<string>;
    readdir(path: string): Promise<string[]>;
    writeFile(path: string, data: string, encoding: string): Promise<void>;
  };
}

declare module "node:path" {
  const path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  };
  export default path;
}

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_WISEEFF_API_AUTHORIZATION?: string;
  readonly VITE_WISEEFF_API_BASE_URL?: string;
  readonly VITE_WISEEFF_RUNTIME_MODE?: string;
  readonly VITE_XIAOZE_PROACTIVE_ENABLED?: string;
  readonly VITE_XIAOZE_REASONING_DEV_EXPANDED?: string;
  readonly VITE_XIAOZE_PROMPT_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
