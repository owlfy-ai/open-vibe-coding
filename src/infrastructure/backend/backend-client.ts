import type {
  BackendAuthPort,
  BackendPlan,
  BackendSession,
  BackendUser,
} from "@/application/backend/auth";
import type { OperationsConfig } from "@/app/operations-config";
import type { JsonValue } from "@/domain/conversation";
import type { ImageSearchInput, ImageSearchResult } from "@/application/ports/research";

const SESSION_STORAGE_KEY = "ovc.backend.session";

export class BackendAuthRequiredError extends Error {
  readonly status = 401;
  readonly code = "backend-auth-required";

  constructor(message = "Sign in required") {
    super(message);
    this.name = "BackendAuthRequiredError";
  }
}

export function isBackendAuthRequiredError(error: unknown): boolean {
  if (error instanceof BackendAuthRequiredError) return true;
  if (typeof error !== "object" || error === null) return false;
  const status = "status" in error ? Number((error as { status: unknown }).status) : undefined;
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  return status === 401 || code === "backend-auth-required";
}

interface OwlfyResponse<T> {
  readonly code: number;
  readonly data?: T;
  readonly message?: string;
  readonly msg?: string;
}

interface OwlfyLoginData {
  readonly token: string;
  readonly expiresAt?: number;
  readonly user: OwlfyUser;
  readonly liteLlmKey?: string;
}

interface OwlfyUserInfoData {
  readonly userInfo?: OwlfyUser;
  readonly user?: OwlfyUser;
  readonly liteLlmKey?: string;
}

interface OwlfyUser {
  readonly ID?: string | number;
  readonly id?: string | number;
  readonly uuid?: string;
  readonly userName?: string;
  readonly nickName?: string;
  readonly firstName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly points?: number;
  readonly freePoints?: number;
  readonly vipPoints?: number;
  readonly vip_level?: number;
  readonly vipExpireAt?: string;
  readonly apiKey?: string;
  readonly liteLlmKey?: string;
}

interface BillingPortalResponse {
  readonly url?: string;
  readonly website?: string;
}

export interface PublishSiteRequest {
  readonly conversationId: string;
  readonly title: string;
  readonly appName: string;
  readonly subdomain?: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface PublishedSite {
  readonly id: number;
  readonly conversationId: string;
  readonly title: string;
  readonly host: string;
  readonly subdomain: string;
  readonly appName: string;
  readonly siteType: string;
  readonly status: string;
  readonly currentVersionId: string;
  readonly url: string;
  readonly thumbnailUrl?: string;
  readonly showInGallery?: boolean;
}

export interface PublishedSiteStatus {
  readonly site: PublishedSite;
  readonly versionId: string;
  readonly buildStatus: "queued" | "building" | "succeeded" | "failed" | string;
  readonly buildLog: string;
  readonly url: string;
}

export interface PublishedGallery {
  readonly list: readonly PublishedGalleryItem[];
  readonly total: number;
}

export interface PublishedGalleryItem {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly authorName: string;
  readonly createdAt: string;
}

export interface CheckPublishNameResult {
  readonly available: boolean;
  readonly message: string;
  readonly url: string;
}

export interface PublishSubDomainResult {
  readonly subdomain: string;
  readonly host: string;
}

export class BackendClient implements BackendAuthPort {
  constructor(private readonly config: OperationsConfig) {}

  current(): BackendSession | null {
    return readSession();
  }

  async login(email: string, sessionToken: string): Promise<BackendSession> {
    void email;
    return this.clerkLogin("email", sessionToken);
  }

  async clerkLogin(provider: "oauth_google" | "email", sessionToken: string): Promise<BackendSession> {
    const data = await this.postOwlfy<OwlfyLoginData>("/api/base/unified-login", {
      provider,
      sessionToken,
    });
    const session = this.persistLoginData(data);
    return (await this.refresh()) ?? session;
  }

  async refresh(): Promise<BackendSession | null> {
    const current = readSession();
    if (!current) return null;
    try {
      const data = await this.getOwlfy<OwlfyUserInfoData>("/api/user/getUserInfo", current.accessToken);
      const owlfyUser = data.userInfo ?? data.user;
      const user = owlfyUser ? normalizeUser(owlfyUser) : current.user;
      const session = {
        ...current,
        user,
        liteLlmKey: normalizeLiteLlmKey(owlfyUser, data.liteLlmKey) ?? current.liteLlmKey,
        vipLevel: owlfyUser ? normalizeVipLevel(owlfyUser) : current.vipLevel,
        plan: owlfyUser ? normalizePlan(owlfyUser) : current.plan,
      };
      writeSession(session);
      return session;
    } catch {
      clearSession();
      return null;
    }
  }

  async logout(): Promise<void> {
    clearSession();
  }

  async createBillingPortal(): Promise<string> {
    const response = await this.getOwlfy<BillingPortalResponse | string>("/api/sysConfig/getByKey?key=website")
      .catch(() => this.config.backendUrl);
    const baseUrl = typeof response === "string" ? response : response.url || response.website || this.config.backendUrl;
    const token = this.current()?.accessToken;
    return `${normalizeExternalUrl(baseUrl)}?page=pricing${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  }

  async publishSite(request: PublishSiteRequest): Promise<PublishedSite> {
    return this.postOwlfy<PublishedSite>("/api/publish/site", {
      conversationId: request.conversationId,
      title: request.title,
      appName: request.appName,
      subdomain: request.subdomain ?? "",
      files: request.files,
    });
  }

  async checkPublishName(appName: string, subdomain = ""): Promise<CheckPublishNameResult> {
    return this.postOwlfy<CheckPublishNameResult>("/api/publish/checkName", { appName, subdomain });
  }

  async setPublishSubDomain(subdomain: string): Promise<PublishSubDomainResult> {
    return this.postOwlfy<PublishSubDomainResult>("/api/publish/subdomain", { subdomain });
  }

  async listPublishedSites(): Promise<readonly PublishedSite[]> {
    return this.getOwlfy<readonly PublishedSite[]>("/api/publish/sites");
  }

  async getPublishedSiteStatus(id: number): Promise<PublishedSiteStatus> {
    return this.getOwlfy<PublishedSiteStatus>(`/api/publish/site/status?id=${encodeURIComponent(String(id))}`);
  }

  async cancelPublishedSite(id: number): Promise<void> {
    await this.postOwlfy<unknown>("/api/publish/site/cancel", { id });
  }

  async listPublishedGallery(pageSize = 6): Promise<PublishedGallery> {
    return this.getOwlfy<PublishedGallery>(`/api/publish/gallery?page=1&pageSize=${pageSize}`, "");
  }

  async searchOfficialImages(input: ImageSearchInput): Promise<readonly ImageSearchResult[]> {
    return this.postOwlfy<readonly ImageSearchResult[]>("/api/publish/image/search", {
      query: input.query,
      imageType: input.imageType ?? "all",
      orientation: input.orientation ?? "all",
      color: input.color ?? "",
      limit: input.limit ?? 10,
    });
  }

  liteLlmBaseUrl(): string {
    return this.config.liteLlmBaseUrl;
  }

  liteLlmModel(): string {
    return this.config.liteLlmModel;
  }

  private persistLoginData(data: OwlfyLoginData): BackendSession {
    const session = {
      accessToken: data.token,
      expiresAt: normalizeExpiresAt(data.expiresAt),
      liteLlmKey: normalizeLiteLlmKey(data.user, data.liteLlmKey),
      vipLevel: normalizeVipLevel(data.user),
      user: normalizeUser(data.user),
      plan: normalizePlan(data.user),
    };
    writeSession(session);
    return session;
  }

  private async getOwlfy<T>(path: string, token?: string): Promise<T> {
    return this.requestOwlfy<T>(path, { method: "GET", token });
  }

  private async postOwlfy<T>(path: string, body: Record<string, JsonValue>): Promise<T> {
    return this.requestOwlfy<T>(path, { method: "POST", body });
  }

  private async requestOwlfy<T>(
    path: string,
    options: {
      readonly method: "GET" | "POST";
      readonly body?: Record<string, JsonValue>;
      readonly token?: string;
    },
  ): Promise<T> {
    const token = options.token ?? readSession()?.accessToken;
    const response = await fetch(`${this.config.backendUrl}${path}`, {
      method: options.method,
      headers: this.headers(token),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    updateSessionTokenFromHeaders(response);
    if (!response.ok) throw await toBackendError(response);
    const envelope = (await response.json()) as OwlfyResponse<T> | T;
    if (isOwlfyEnvelope(envelope)) {
      if (envelope.code !== 0) {
        throw new Error(envelope.message || envelope.msg || `Owlfy API returned code ${envelope.code}`);
      }
      return envelope.data as T;
    }
    return envelope;
  }

  private headers(token?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "X-Token": token } : {}),
    };
  }
}

function normalizeUser(user: OwlfyUser): BackendUser {
  return {
    id: String(user.ID ?? user.id ?? user.uuid ?? ""),
    email: user.email || user.phone || "",
    name: user.nickName || user.firstName || user.userName || user.email || user.phone || undefined,
  };
}

function normalizePlan(user?: OwlfyUser): BackendPlan {
  return {
    name: user?.vip_level ? "Pro" : "Free",
    status: user?.vip_level ? "active" : "none",
    creditsRemaining: totalPoints(user),
    renewsAt: user?.vipExpireAt,
  };
}

function normalizeLiteLlmKey(user?: OwlfyUser, fallback?: string): string | undefined {
  return user?.liteLlmKey?.trim() || fallback?.trim() || undefined;
}

function normalizeVipLevel(user?: OwlfyUser): number {
  return user?.vip_level ?? 0;
}

function normalizeExpiresAt(value?: number): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function totalPoints(user?: OwlfyUser): number {
  return (user?.points ?? 0) + (user?.freePoints ?? 0) + (user?.vipPoints ?? 0);
}

function isOwlfyEnvelope<T>(value: OwlfyResponse<T> | T): value is OwlfyResponse<T> {
  return typeof value === "object" && value !== null && "code" in value;
}

function readSession(): BackendSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BackendSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: BackendSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function updateSessionTokenFromHeaders(response: Response): void {
  const token = response.headers.get("new-token");
  if (!token) return;
  const current = readSession();
  if (!current) return;
  const expiresAt = normalizeExpiresAt(Number(response.headers.get("new-expires-at")));
  writeSession({
    ...current,
    accessToken: token,
    expiresAt: expiresAt ?? current.expiresAt,
  });
}

function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

async function toBackendError(response: Response): Promise<Error & { status: number }> {
  const detail = await response.text();
  if (response.status === 401) {
    clearSession();
    return new BackendAuthRequiredError(detail.trim() || "Sign in required") as Error & { status: number };
  }
  const error = new Error(detail.trim() || `Backend request failed with HTTP ${response.status}`) as Error & {
    status: number;
  };
  error.status = response.status;
  return error;
}
