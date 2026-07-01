import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth, useSession, useSignIn } from "@clerk/clerk-react";
import { BackendClient } from "@/infrastructure/backend";
import type { BackendSession } from "@/application/backend";
import type { OperationsConfig } from "@/app/operations-config";
import { useApplication } from "../runtime";
import { useT } from "../i18n";

interface BackendAccountContextValue {
  readonly client: BackendClient;
  readonly session: BackendSession;
  readonly logout: () => Promise<void>;
}

const BackendAccountContext = createContext<BackendAccountContextValue | null>(null);

export function BackendAuthGate({
  config,
  children,
}: {
  readonly config: OperationsConfig;
  readonly children: ReactNode;
}) {
  const { refreshServices } = useApplication();
  const t = useT();
  const client = useMemo(() => new BackendClient(config), [config]);
  const [session, setSession] = useState<BackendSession | null>(() => client.current());
  const [loading, setLoading] = useState(Boolean(client.current()));

  useEffect(() => {
    let active = true;
    setLoading(Boolean(client.current()));
    client.refresh().then((next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
      if (next) refreshServices();
    });
    return () => {
      active = false;
    };
  }, [client, refreshServices]);

  if (loading) return <main className="ob-center">{t.auth.restoring}</main>;
  if (!session) {
    return (
      <main className="ob-auth-page">
        <LoginForm
          appName={config.appName}
          client={client}
          onSession={(next) => {
            setSession(next);
            refreshServices();
          }}
        />
      </main>
    );
  }
  const account = {
    client,
    session,
    logout: async () => {
      await client.logout();
      setSession(null);
      refreshServices();
    },
  };
  return (
    <BackendAccountContext.Provider value={account}>
      {children}
    </BackendAccountContext.Provider>
  );
}

export function useBackendAccount(): BackendAccountContextValue | null {
  return useContext(BackendAccountContext);
}

function LoginForm({
  appName,
  client,
  onSession,
}: {
  readonly appName: string;
  readonly client: BackendClient;
  readonly onSession: (session: BackendSession) => void;
}) {
  const t = useT();
  const { session, isLoaded: sessionLoaded } = useSession();
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
  const { getToken } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useCountdown();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const exchangedSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionLoaded || !session || exchangedSessionId.current === session.id) return;
    exchangedSessionId.current = session.id;
    setBusy(true);
    session.getToken()
      .then((sessionToken) => {
        if (!sessionToken) throw new Error(t.auth.loginFailed);
        return client.clerkLogin("oauth_google", sessionToken);
      })
      .then(onSession)
      .catch((failure) => {
        exchangedSessionId.current = null;
        setError(failure instanceof Error ? failure.message : t.auth.loginFailed);
      })
      .finally(() => setBusy(false));
  }, [client, onSession, session, sessionLoaded, t.auth.loginFailed]);

  async function openGoogle() {
    if (!signInLoaded || !signIn) {
      setError(t.auth.loginFailed);
      return;
    }
    await signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: `${window.location.origin}/auth/clerk-callback`,
      redirectUrlComplete: window.location.origin,
    });
  }

  async function sendCode() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || countdown > 0) {
      setError(t.auth.invalidEmail);
      return;
    }
    if (!signInLoaded || !signIn) {
      setError(t.auth.loginFailed);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await signIn.create({ identifier: email });
      const emailFactor = signIn.supportedFirstFactors?.find(
        (factor) => factor.strategy === "email_code",
      );
      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: typeof emailFactor === "object" && emailFactor && "emailAddressId" in emailFactor
          ? String(emailFactor.emailAddressId)
          : "",
      });
      setCodeSent(true);
      setCountdown(60);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.auth.codeSendFailed);
    } finally {
      setSending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!signInLoaded || !signIn || !setActive) {
      setError(t.auth.loginFailed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code,
      });
      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error(t.auth.loginFailed);
      }
      await setActive({ session: result.createdSessionId });
      const sessionToken = await getToken();
      if (!sessionToken) throw new Error(t.auth.loginFailed);
      onSession(await client.clerkLogin("email", sessionToken));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.auth.loginFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ob-auth-card" onSubmit={submit}>
      <header>
        <small>{appName}</small>
        <h1>{t.auth.title}</h1>
        <p>{t.auth.subtitle}</p>
      </header>
      <button type="button" className="ob-oauth-button" onClick={() => void openGoogle()}>
        <GoogleMark />
        {t.auth.gmailLogin}
      </button>
      <div className="ob-auth-divider"><span>{t.auth.orEmailCode}</span></div>
      <label className="ob-field">
        <span>{t.auth.email}</span>
        <input
          autoComplete="email"
          inputMode="email"
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="ob-field">
        <span>{t.auth.verificationCode}</span>
        <div className="ob-code-row">
          <input required value={code} onChange={(event) => setCode(event.target.value)} />
          <button type="button" className="ob-secondary-button" disabled={sending || countdown > 0} onClick={sendCode}>
            {countdown > 0 ? `${countdown}s` : sending ? t.auth.sendingCode : t.auth.sendCode}
          </button>
        </div>
        {codeSent ? <small className="ob-auth-hint">{t.auth.codeSent}</small> : null}
      </label>
      {error ? <p className="ob-auth-error">{error}</p> : null}
      <button className="ob-primary-button" disabled={busy}>
        {busy ? t.auth.signingIn : t.auth.signIn}
      </button>
    </form>
  );
}

function useCountdown(): [number, (value: number) => void] {
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);
  return [countdown, setCountdown];
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4c-7.7 0-14.3 4.3-17.7 10.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  );
}
