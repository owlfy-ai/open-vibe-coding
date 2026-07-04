import type { LandingCopy } from "./landingCopy";

export function LandingFooter({
  copy,
}: {
  readonly copy: LandingCopy["footer"];
}) {
  return (
    <footer className="ob-landing-footer">
      <div className="ob-landing-container ob-landing-footer-inner">
        <div className="ob-landing-footer-brand">
          <img src="/logo.svg" alt="" />
          <div>
            <strong>Open Vibe Coding</strong>
            <small>{copy.tagline}</small>
          </div>
        </div>
        <span className="ob-landing-footer-rights">{copy.rights}</span>
      </div>
    </footer>
  );
}
