import { useEffect, useState } from "react";
import type { LandingCopy } from "./landingCopy";

const GITHUB_URL = "https://github.com/owlfy-ai/open-vibe-coding";

export function LandingNav({
  copy,
  onStart,
}: {
  readonly copy: LandingCopy["nav"];
  readonly onStart: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Stay transparent (blended into the hero) while the hero is in view;
      // only pick up a surface once the hero has scrolled past the nav.
      const hero = document.querySelector(".ob-landing-hero");
      setScrolled(hero ? hero.getBoundingClientRect().bottom < 80 : window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`ob-landing-nav ${scrolled ? "is-scrolled" : ""}`}>
      <div className="ob-landing-container ob-landing-nav-inner">
        <a className="ob-landing-brand" href="#top" aria-label={copy.brand}>
          <img src="/logo.svg" alt="" />
          <span>{copy.brand}</span>
        </a>
        <nav className="ob-landing-nav-links" aria-label="sections">
          <a href="#features">{copy.features}</a>
          <a href="#how">{copy.howItWorks}</a>
          <a href="#gallery">{copy.gallery}</a>
        </nav>
        <div className="ob-landing-nav-right">
          <a
            className="ob-landing-nav-icon"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            <GithubMark />
          </a>
          <button className="ob-landing-nav-cta" type="button" onClick={onStart}>
            {copy.startCta}
          </button>
        </div>
      </div>
    </header>
  );
}

function GithubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.37.5 0 5.78 0 12.292c0 5.211 3.435 9.63 8.205 11.188.6.111.82-.254.82-.567 0-.28-.01-1.022-.015-2.005-3.338.711-4.042-1.582-4.042-1.582-.546-1.361-1.335-1.725-1.335-1.725-1.087-.731.084-.716.084-.716 1.205.082 1.838 1.215 1.838 1.215 1.07 1.803 2.809 1.282 3.495.981.108-.763.417-1.282.76-1.577-2.665-.295-5.466-1.309-5.466-5.827 0-1.287.465-2.339 1.235-3.164-.135-.298-.54-1.497.105-3.121 0 0 1.005-.316 3.3 1.209.96-.262 1.98-.392 3-.398 1.02.006 2.04.136 3 .398 2.28-1.525 3.285-1.209 3.285-1.209.645 1.624.24 2.823.12 3.121.765.825 1.23 1.877 1.23 3.164 0 4.53-2.805 5.527-5.475 5.817.42.354.81 1.077.81 2.169 0 1.566-.015 2.828-.015 3.21 0 .315.21.683.825.567C20.565 21.917 24 17.495 24 12.292 24 5.78 18.627.5 12 .5z" />
    </svg>
  );
}
