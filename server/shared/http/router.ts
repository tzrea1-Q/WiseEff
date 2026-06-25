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
} | {
  status: number;
  text: string;
  contentType: string;
} | {
  status: number;
  bytes: Buffer;
  contentType: string;
  fileName?: string;
} | {
  status: 200;
  sse: AsyncIterable<{ event: string; data: unknown }>;
};

export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse>;

type RouteEntry = {
  method: HttpMethod;
  pattern: string;
  segments: string[];
  staticCount: number;
  handler: RouteHandler;
};

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

function decodeRouteParam(pathSegment: string, path: string) {
  try {
    return decodeURIComponent(pathSegment);
  } catch (error) {
    if (error instanceof URIError) {
      throw new ApiError("VALIDATION_FAILED", "Route parameter is not valid URL encoding.", 400, { path });
    }
    throw error;
  }
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
      params[routeSegment.slice(1)] = decodeRouteParam(pathSegment, request.path);
    } else if (routeSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

function compareEqualStaticCountPrecedence(left: RouteEntry, right: RouteEntry) {
  for (let index = 0; index < left.segments.length; index += 1) {
    const leftIsDynamic = left.segments[index].startsWith(":");
    const rightIsDynamic = right.segments[index].startsWith(":");
    if (leftIsDynamic !== rightIsDynamic) {
      return leftIsDynamic ? 1 : -1;
    }
  }

  return 0;
}

export function createRouter() {
  const routes: RouteEntry[] = [];

  function add(method: HttpMethod, path: string, handler: RouteHandler) {
    const segments = splitPath(path);
    const staticCount = segments.filter((segment) => !segment.startsWith(":")).length;
    routes.push({ method, pattern: path, segments, staticCount, handler });
  }

  return {
    get: (path: string, handler: RouteHandler) => add("GET", path, handler),
    post: (path: string, handler: RouteHandler) => add("POST", path, handler),
    put: (path: string, handler: RouteHandler) => add("PUT", path, handler),
    patch: (path: string, handler: RouteHandler) => add("PATCH", path, handler),
    delete: (path: string, handler: RouteHandler) => add("DELETE", path, handler),
    matchRoutePattern(method: HttpMethod, path: string) {
      const matchingRoutes = routes
        .map((route) => ({
          route,
          params: matchRoute(route, { method, path, params: {}, query: {}, headers: {}, requestId: "", body: undefined })
        }))
        .filter((match): match is { route: RouteEntry; params: Record<string, string> } => match.params !== undefined)
        .sort((left, right) => right.route.staticCount - left.route.staticCount || compareEqualStaticCountPrecedence(left.route, right.route));

      return matchingRoutes[0]?.route.pattern;
    },
    async handle(request: RouteRequest): Promise<RouteResponse> {
      const matchingRoutes = routes
        .map((route) => ({ route, params: matchRoute(route, request) }))
        .filter((match): match is { route: RouteEntry; params: Record<string, string> } => match.params !== undefined)
        .sort((left, right) => right.route.staticCount - left.route.staticCount || compareEqualStaticCountPrecedence(left.route, right.route));
      const match = matchingRoutes[0];
      if (!match) {
        throw new ApiError("NOT_FOUND", "Route not found.", 404, { path: request.path });
      }
      return match.route.handler({ ...request, params: { ...request.params, ...match.params } });
    }
  };
}

export type WiseEffRouter = ReturnType<typeof createRouter>;
