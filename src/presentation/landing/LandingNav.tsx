import { useEffect, useState } from "react";
import type { LandingCopy } from "./landingCopy";

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
        <button className="ob-landing-nav-cta" type="button" onClick={onStart}>
          {copy.startCta}
        </button>
      </div>
    </header>
  );
}
