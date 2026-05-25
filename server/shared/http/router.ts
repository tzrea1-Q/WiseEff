import { ApiError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteRequest = {
  method: HttpMethod;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  requestId: string;
  body: unknown;
};

export type RouteResponse = {
  status: number;
  body: unknown;
};

export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse>;

function key(method: HttpMethod, path: string) {
  return `${method} ${path}`;
}

export function createRouter() {
  const routes = new Map<string, RouteHandler>();

  function add(method: HttpMethod, path: string, handler: RouteHandler) {
    routes.set(key(method, path), handler);
  }

  return {
    get: (path: string, handler: RouteHandler) => add("GET", path, handler),
    post: (path: string, handler: RouteHandler) => add("POST", path, handler),
    put: (path: string, handler: RouteHandler) => add("PUT", path, handler),
    patch: (path: string, handler: RouteHandler) => add("PATCH", path, handler),
    delete: (path: string, handler: RouteHandler) => add("DELETE", path, handler),
    async handle(request: RouteRequest): Promise<RouteResponse> {
      const handler = routes.get(key(request.method, request.path));
      if (!handler) {
        throw new ApiError("NOT_FOUND", "Route not found.", 404, { path: request.path });
      }
      return handler(request);
    }
  };
}

export type WiseEffRouter = ReturnType<typeof createRouter>;
