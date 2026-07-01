import { useEffect, useState } from "react";
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
import { dictionary, resolveLanguage } from "./i18n";
import "./styles.css";

type BootState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly runtime: ApplicationRuntime }
  | { readonly status: "error"; readonly error: ApplicationBootstrapError };

export function AppRoot() {
  const [state, setState] = useState<BootState>({ status: "loading" });
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
  if (window.location.pathname === "/auth/clerk-callback") {
    return (
      <ClerkProvider publishableKey={operations.clerkPublishableKey}>
        <main className="ob-center">{t.auth.restoring}</main>
        <AuthenticateWithRedirectCallback
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
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
