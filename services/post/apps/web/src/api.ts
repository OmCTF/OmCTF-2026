import type {
  HealthResponse,
  VersionResponse,
} from "../../../packages/contracts/generated/ts/models";

export interface Snapshot {
  live: HealthResponse;
  ready: HealthResponse;
  version: VersionResponse;
  checkedAt: Date;
}

async function get<T>(path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path, { signal: AbortSignal.timeout(4500), cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok && !(response.status === 503 && path.endsWith("/ready"))) {
    throw new Error(`API вернул HTTP ${response.status}`);
  }
  if (!body || typeof body !== "object" || !("request_id" in body) || !("service" in body)) {
    throw new Error("Некорректный ответ API");
  }
  return body as T;
}

export async function readStatus(fetcher: typeof fetch = fetch): Promise<Snapshot> {
  const [live, ready, version] = await Promise.all([
    get<HealthResponse>("/health/live", fetcher),
    get<HealthResponse>("/health/ready", fetcher),
    get<VersionResponse>("/api/v1/version", fetcher),
  ]);
  if (
    !["ok", "unavailable"].includes(live.status) ||
    !["ok", "unavailable"].includes(ready.status) ||
    !Array.isArray(ready.dependencies) ||
    typeof version.version !== "string"
  ) {
    throw new Error("Несовместимый контракт API");
  }
  return { live, ready, version, checkedAt: new Date() };
}
