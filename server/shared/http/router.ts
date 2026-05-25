import { ApiError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteRequest = {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
  requestId: string;
  body: unknown;
};

export type RouteResponse = {
  status: number;
  body: unknown;
};

export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse>;

type RouteEntry = {
  method: HttpMethod;
  pattern: string;
  segments: string[];
  handler: RouteHandler;
};

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

function matchRoute(entry: RouteEntry, request: RouteRequest) {
  if (entry.method !== request.method) {
    return undefined;
  }

  const pathSegments = splitPath(request.path);
  if (entry.segments.length !== pathSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < entry.segments.length; index += 1) {
    const routeSegment = entry.segments[index];
    const pathSegment = pathSegments[index];
    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (routeSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

export function createRouter() {
  const routes: RouteEntry[] = [];

  function add(method: HttpMethod, path: string, handler: RouteHandler) {
    routes.push({ method, pattern: path, segments: splitPath(path), handler });
  }

  return {
    get: (path: string, handler: RouteHandler) => add("GET", path, handler),
    post: (path: string, handler: RouteHandler) => add("POST", path, handler),
    put: (path: string, handler: RouteHandler) => add("PUT", path, handler),
    patch: (path: string, handler: RouteHandler) => add("PATCH", path, handler),
    delete: (path: string, handler: RouteHandler) => add("DELETE", path, handler),
    async handle(request: RouteRequest): Promise<RouteResponse> {
      const matchingRoutes = routes
        .map((route) => ({ route, params: matchRoute(route, request) }))
        .filter((match): match is { route: RouteEntry; params: Record<string, string> } => match.params !== undefined)
        .sort((left, right) => {
          const leftDynamicSegments = left.route.segments.filter((segment) => segment.startsWith(":")).length;
          const rightDynamicSegments = right.route.segments.filter((segment) => segment.startsWith(":")).length;
          return leftDynamicSegments - rightDynamicSegments;
        });
      const match = matchingRoutes[0];
      if (!match) {
        throw new ApiError("NOT_FOUND", "Route not found.", 404, { path: request.path });
      }
      return match.route.handler({ ...request, params: { ...request.params, ...match.params } });
    }
  };
}

export type WiseEffRouter = ReturnType<typeof createRouter>;
