export interface BackendUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
}

export interface BackendPlan {
  readonly name: string;
  readonly status: "trialing" | "active" | "past_due" | "canceled" | "none";
  readonly creditsRemaining?: number;
  readonly renewsAt?: string;
}

export interface BackendSession {
  readonly accessToken: string;
  readonly expiresAt?: number;
  readonly liteLlmKey?: string;
  readonly vipLevel?: number;
  readonly publishSubDomain?: string;
  readonly user: BackendUser;
  readonly plan: BackendPlan;
}

export interface BackendAuthPort {
  current(): BackendSession | null;
  login(email: string, password: string): Promise<BackendSession>;
  refresh(): Promise<BackendSession | null>;
  logout(): Promise<void>;
  createBillingPortal(): Promise<string>;
}
