import { useCallback, useEffect, useState } from "react";
import { AuthenticateWithRedirectCallback, ClerkProvider } from "@clerk/clerk-react";
import {
  ApplicationBootstrapError,
  bootstrapApplication,
  type ApplicationRuntime,
} from "@/app/bootstrap";
import { ApplicationProvider } from "./runtime";
import { getOperationsConfig } from "@/app/operations-config";
import { BackendAuthGate } from "./auth/BackendAuthGate";
import { ThemeProvider } from "./theme/ThemeProvider";
import { AppShell } from "./shell/AppShell";
import { Landing } from "./landing/Landing";
import { dictionary, resolveLanguage } from "./i18n";
import "./styles.css";

type BootState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly runtime: ApplicationRuntime }
  | { readonly status: "error"; readonly error: ApplicationBootstrapError };

type View = "landing" | "studio";

const STUDIO_HASH = "#studio";
const CLERK_CALLBACK_PATH = "/auth/clerk-callback";
const STUDIO_REDIRECT_PATH = "/#studio";

/**
 * Landing is the default view; the studio is shown when the hash is `#studio`
 * (set by "Start creating") or when on the Clerk callback path. Hash-based so a
 * refresh survives on hosts without SPA fallback (e.g. GitHub Pages); the
 * browser back/forward buttons drive it via `hashchange`.
 */
function resolveView(): View {
  if (typeof window === "undefined") return "landing";
  if (window.location.pathname === CLERK_CALLBACK_PATH) return "studio";
  if (window.location.hash === STUDIO_HASH) return "studio";
  return "landing";
}

export function AppRoot() {
  const [state, setState] = useState<BootState>({ status: "loading" });
  const [view, setView] = useState<View>(() => resolveView());
  const t = dictionary(resolveLanguage("system"));
  const operations = getOperationsConfig();

  useEffect(() => {
    let active = true;
    bootstrapApplication().then(
      (runtime) => active && setState({ status: "ready", runtime }),
      (error: unknown) => {
        if (!active) return;
        const failure =
          error instanceof ApplicationBootstrapError
            ? error
            : new ApplicationBootstrapError("bootstrap-error", "database", "Application failed to start");
        setState({ status: "error", error: failure });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setView(resolveView());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const enterStudio = useCallback(() => {
    setView("studio");
    if (window.location.hash !== STUDIO_HASH) {
      window.location.hash = "studio";
    }
  }, []);

  // The landing paints instantly and has no dependency on bootstrap, the
  // runtime, or Clerk. Bootstrap continues in the background while it shows.
  if (view === "landing") {
    return <Landing onStart={enterStudio} />;
  }

  if (state.status === "loading") {
    return <main className="ob-center"><p>{t.app.loading}</p></main>;
  }
  if (state.status === "error") {
    return (
      <main className="ob-center ob-error-page">
        <h1>{t.app.startFailed}</h1>
        <p>{state.error.message}</p>
        <small>{t.app.dataSafe}</small>
      </main>
    );
  }
  const app = (
    <ApplicationProvider runtime={state.runtime}>
      <ThemeProvider>
        <BackendAuthGate config={operations}>
          <AppShell />
        </BackendAuthGate>
      </ThemeProvider>
    </ApplicationProvider>
  );
  if (!operations.clerkPublishableKey) {
    return (
      <main className="ob-center ob-error-page">
        <h1>{t.app.startFailed}</h1>
        <p>VITE_CLERK_PUBLISHABLE_KEY is required for login.</p>
      </main>
    );
  }
  if (window.location.pathname === CLERK_CALLBACK_PATH) {
    return (
      <ClerkProvider publishableKey={operations.clerkPublishableKey}>
        <main className="ob-center">{t.auth.restoring}</main>
        <AuthenticateWithRedirectCallback
          signInFallbackRedirectUrl={STUDIO_REDIRECT_PATH}
          signUpFallbackRedirectUrl={STUDIO_REDIRECT_PATH}
        />
      </ClerkProvider>
    );
  }
  return (
    <ClerkProvider publishableKey={operations.clerkPublishableKey}>
      {app}
    </ClerkProvider>
  );
}
