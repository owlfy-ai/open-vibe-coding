import { useEffect, useState } from "react";
import {
  ApplicationBootstrapError,
  bootstrapApplication,
  type ApplicationRuntime,
} from "@/app/bootstrap";
import { ApplicationProvider } from "./runtime";
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
  return (
    <ApplicationProvider runtime={state.runtime}>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </ApplicationProvider>
  );
}
