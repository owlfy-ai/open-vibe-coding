import type { AppSettings } from "@/domain/settings";
import type { Result } from "@/shared/result";

export interface ResearchError {
  readonly code: "disabled" | "invalid-input" | "request-failed" | "empty-result";
  readonly message: string;
}

export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

export interface WebPageResult {
  readonly url: string;
  readonly ok: boolean;
  readonly content?: string;
  readonly error?: string;
}

export interface WebResearchPort {
  search(
    settings: AppSettings["webSearch"],
    query: string,
    maxResults: number,
    signal: AbortSignal,
  ): Promise<Result<{ answer: string | null; results: readonly WebSearchResult[] }, ResearchError>>;
  read(
    settings: AppSettings["webSearch"],
    urls: readonly string[],
    signal: AbortSignal,
  ): Promise<Result<{ pages: readonly WebPageResult[] }, ResearchError>>;
}

export interface ImageSearchInput {
  readonly query: string;
  readonly imageType?: "all" | "photo" | "illustration" | "vector";
  readonly orientation?: "all" | "horizontal" | "vertical";
  readonly color?: string;
  readonly limit?: number;
}

export interface ImageSearchResult {
  readonly url: string;
  readonly thumbnail: string;
  readonly width: number;
  readonly height: number;
  readonly description: string;
}

export interface ImageResearchPort {
  search(
    settings: AppSettings["assetSearch"],
    input: ImageSearchInput,
    signal: AbortSignal,
  ): Promise<Result<readonly ImageSearchResult[], ResearchError>>;
}

export interface PackageSearchResult {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly score: {
    readonly final: number;
    readonly quality: number;
    readonly popularity: number;
    readonly maintenance: number;
  };
}

export interface PackageDetail {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly hasTypes: boolean;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly readme: string;
}

export interface PackageResearchPort {
  search(
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<Result<readonly PackageSearchResult[], ResearchError>>;
  detail(
    packageName: string,
    signal: AbortSignal,
  ): Promise<Result<PackageDetail, ResearchError>>;
}
