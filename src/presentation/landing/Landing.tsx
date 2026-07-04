import { useEffect } from "react";
import { applyTheme, subscribeToSystemTheme, systemPrefersDark } from "../theme/theme";
import { Icon } from "../icons";
import { resolveLandingCopy } from "./landingCopy";
import { LandingNav } from "./LandingNav";
import { LandingHero } from "./LandingHero";
import { LandingFeatures } from "./LandingFeatures";
import { LandingHowItWorks } from "./LandingHowItWorks";
import { LandingFooter } from "./LandingFooter";
import "./landing.css";

/**
 * Marketing landing page shown at `/`. Renders with no dependency on the
 * application runtime, Clerk, or bootstrap, so it paints instantly; the studio
 * (AppShell) is only mounted after the user clicks "Start creating".
 */
export function Landing({ onStart }: { readonly onStart: () => void }) {
  const copy = resolveLandingCopy();

  // The studio shell constrains body to a fixed 1040px, overflow-hidden desktop
  // layout. Relax that while the landing is mounted so this page can scroll and
  // be responsive. Idempotent under StrictMode.
  useEffect(() => {
    document.body.classList.add("ob-landing-active");
    return () => document.body.classList.remove("ob-landing-active");
  }, []);

  // index.html presets data-theme from prefers-color-scheme before first paint,
  // so tokens resolve with no JS. But ThemeProvider (which normally keeps it in
  // sync) is only mounted inside the studio. While on the landing, re-apply the
  // system theme ourselves so an OS theme change updates live.
  useEffect(() => {
    const sync = () => applyTheme(systemPrefersDark() ? "dark" : "light");
    sync();
    return subscribeToSystemTheme(sync);
  }, []);

  return (
    <div className="ob-landing">
      <LandingNav copy={copy.nav} onStart={onStart} />
      <LandingHero copy={copy.hero} onStart={onStart} />
      <LandingFeatures copy={copy.features} />
      <LandingHowItWorks steps={copy.steps} showcase={copy.showcase} onStart={onStart} />

      <section className="ob-landing-container" aria-label={copy.cta.title}>
        <div className="ob-landing-cta-band">
          <div className="ob-landing-cta-band-inner">
            <h2>{copy.cta.title}</h2>
            <p>{copy.cta.subtitle}</p>
            <button
              type="button"
              className="ob-landing-cta ob-landing-cta--lg"
              onClick={onStart}
            >
              {copy.cta.button}
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        </div>
      </section>

      <LandingFooter copy={copy.footer} />
    </div>
  );
}
