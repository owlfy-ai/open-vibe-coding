import type {
  BackendAuthPort,
  BackendPlan,
  BackendSession,
  BackendUser,
} from "@/application/backend/auth";
import type { JsonValue } from "@/domain/conversation";
import type { OperationsConfig } from "@/app/operations-config";

const SESSION_STORAGE_KEY = "ovc.backend.session";

interface OwlfyResponse<T> {
  readonly code: number;
  readonly data?: T;
  readonly message?: string;
  readonly msg?: string;
}

interface OwlfyLoginData {
  readonly token: string;
  readonly user: OwlfyUser;
}

interface OwlfyUserInfoData {
  readonly userInfo?: OwlfyUser;
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
}

interface BillingPortalResponse {
  readonly url?: string;
  readonly website?: string;
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
    return this.persistLoginData(data);
  }

  async refresh(): Promise<BackendSession | null> {
    const current = readSession();
    if (!current) return null;
    try {
      const data = await this.getOwlfy<OwlfyUserInfoData>("/api/user/getUserInfo", current.accessToken);
      const user = data.userInfo ? normalizeUser(data.userInfo) : current.user;
      const session = { ...current, user, plan: normalizePlan(data.userInfo) };
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

  async *streamAgent(
    payload: JsonValue,
    signal: AbortSignal,
  ): AsyncIterable<JsonValue> {
    const response = await fetch(`${this.config.backendUrl}/api/agent/stream`, {
      method: "POST",
      headers: this.headers(readSession()?.accessToken),
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) throw await toBackendError(response);
    if (!response.body) throw new Error("Backend response did not include a stream body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          yield JSON.parse(trimmed) as JsonValue;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) yield JSON.parse(buffer.trim()) as JsonValue;
    } finally {
      reader.releaseLock();
    }
  }

  private persistLoginData(data: OwlfyLoginData): BackendSession {
    const session = {
      accessToken: data.token,
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

async function toBackendError(response: Response): Promise<Error & { status: number }> {
  const detail = await response.text();
  const error = new Error(detail.trim() || `Backend request failed with HTTP ${response.status}`) as Error & {
    status: number;
  };
  error.status = response.status;
  return error;
}
