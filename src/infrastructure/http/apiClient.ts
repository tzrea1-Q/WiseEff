export class WiseEffApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown>,
    public readonly requestId: string
  ) {
    super(message);
    this.name = "WiseEffApiError";
  }
}

type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

async function parseJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function createApiClient({ baseUrl, fetchImpl = fetch }: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, init);
    const body = await parseJson(response);

    if (!response.ok) {
      const error = body?.error ?? {};
      throw new WiseEffApiError(error.code ?? "INTERNAL_ERROR", error.message ?? "Request failed.", error.details ?? {}, error.requestId ?? "");
    }

    return body as T;
  }

  return {
    get: <T>(path: string) =>
      request<T>(path, {
        method: "GET",
        headers: { Accept: "application/json" }
      }),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
    delete: <T>(path: string) =>
      request<T>(path, {
        method: "DELETE",
        headers: { Accept: "application/json" }
      }),
    upload: <T>(path: string, file: File, fields: Record<string, string> = {}) => {
      const formData = new FormData();
      formData.append("file", file);
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }

      return request<T>(path, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData
      });
    }
  };
}
