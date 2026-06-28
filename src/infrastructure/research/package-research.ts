import type {
  PackageDetail,
  PackageResearchPort,
  PackageSearchResult,
  ResearchError,
} from "@/application/ports/research";
import type { HttpClient, HttpError } from "@/infrastructure/http";
import type { Clock } from "@/shared/clock";
import { err, ok, type Result } from "@/shared/result";

type RecordValue = Record<string, unknown>;

export class PackageResearchAdapter implements PackageResearchPort {
  private readonly cache = new Map<string, { readonly expiresAt: number; readonly value: unknown }>();

  constructor(
    private readonly http: HttpClient,
    private readonly clock: Clock,
    private readonly cacheTtlMs = 10 * 60 * 1_000,
  ) {}

  async search(
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<Result<readonly PackageSearchResult[], ResearchError>> {
    const parameters = new URLSearchParams({
      q: query,
      size: String(clamp(limit, 1, 15)),
    });
    const response = await this.cachedJson<RecordValue>(
      `https://api.npms.io/v2/search?${parameters}`,
      signal,
    );
    if (!response.ok) return failure(response.error);
    return ok(records(response.value.results).map(mapPackageSearch));
  }

  async detail(
    packageName: string,
    signal: AbortSignal,
  ): Promise<Result<PackageDetail, ResearchError>> {
    if (!/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(packageName)) {
      return err({ code: "invalid-input", message: "Invalid npm package name" });
    }
    const response = await this.cachedJson<RecordValue>(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      signal,
    );
    if (!response.ok) return failure(response.error);
    const tags = record(response.value["dist-tags"]);
    const versions = record(response.value.versions);
    const version = string(tags.latest) || Object.keys(versions).at(-1) || "";
    const selected = record(versions[version]);
    if (!version || Object.keys(selected).length === 0) {
      return err({ code: "empty-result", message: `Package not found: ${packageName}` });
    }
    const dependencies = stringRecord(selected.dependencies);
    return ok({
      name: packageName,
      version,
      description: string(selected.description),
      license: license(selected.license),
      hasTypes:
        typeof selected.types === "string" ||
        typeof selected.typings === "string" ||
        Object.keys(dependencies).some((name) => name.startsWith("@types/")),
      dependencies,
      peerDependencies: stringRecord(selected.peerDependencies),
      readme: string(response.value.readme).slice(0, 2_000),
    });
  }

  private async cachedJson<T>(
    url: string,
    signal: AbortSignal,
  ): Promise<Result<T, HttpError>> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > this.clock.now()) return ok(cached.value as T);
    const response = await this.http.json<T>(url, { signal, timeoutMs: 10_000 });
    if (response.ok) {
      this.cache.set(url, {
        expiresAt: this.clock.now() + this.cacheTtlMs,
        value: response.value,
      });
    }
    return response;
  }
}

function mapPackageSearch(item: RecordValue): PackageSearchResult {
  const pkg = record(item.package);
  const score = record(item.score);
  const detail = record(score.detail);
  return {
    name: string(pkg.name),
    version: string(pkg.version),
    description: string(pkg.description),
    score: {
      final: rounded(number(score.final)),
      quality: rounded(number(detail.quality)),
      popularity: rounded(number(detail.popularity)),
      maintenance: rounded(number(detail.maintenance)),
    },
  };
}

function failure(error: HttpError): Result<never, ResearchError> {
  return err({ code: "request-failed", message: error.message });
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function record(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function license(value: unknown): string {
  if (typeof value === "string") return value;
  return string(record(value).type);
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}
