import type { LandingCopy } from "./landingCopy";
import { Icon } from "../icons";

export function LandingHero({
  copy,
  onStart,
}: {
  readonly copy: LandingCopy["hero"];
  readonly onStart: () => void;
}) {
  return (
    <section className="ob-landing-hero" id="top">
      <div className="ob-landing-hero-glow" aria-hidden="true" />
      <div className="ob-landing-container ob-landing-hero-content">
        <h1>{copy.title}</h1>
        <p className="ob-landing-hero-sub">{copy.subtitle}</p>
        <div className="ob-landing-hero-actions">
          <button
            type="button"
            className="ob-landing-cta ob-landing-cta--lg"
            onClick={onStart}
          >
            {copy.primaryCta}
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
        <p className="ob-landing-hero-note">
          <span className="ob-landing-dot" aria-hidden="true" />
          {copy.secondaryNote}
        </p>
      </div>

      <div className="ob-landing-container">
        <ProductMockup copy={copy.mockup} />
      </div>
    </section>
  );
}

/**
 * A static, pure-CSS/JSX stand-in for the studio (chat + live preview).
 * Decorative only — no Sandpack, no runtime cost. Marked aria-hidden.
 */
function ProductMockup({
  copy,
}: {
  readonly copy: LandingCopy["hero"]["mockup"];
}) {
  return (
    <div className="ob-landing-mockup" aria-hidden="true">
      <div className="ob-landing-mockup-frame">
        <div className="ob-landing-mockup-chrome">
          <span className="ob-landing-mockup-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="ob-landing-mockup-url">
            <Icon name="globe" size={13} />
            {copy.url}
          </span>
          <span className="ob-landing-mockup-published">
            <Icon name="check" size={12} />
            {copy.published}
          </span>
        </div>
        <div className="ob-landing-mockup-body">
          <div className="ob-landing-mockup-chat">
            <div className="ob-landing-mockup-bubble is-user">{copy.userMsg}</div>
            <div className="ob-landing-mockup-bubble is-agent">{copy.agentMsg}</div>
            <div className="ob-landing-mockup-composer">
              <span />
              <span className="ob-landing-mockup-send">
                <Icon name="send" size={13} />
              </span>
            </div>
          </div>
          <div className="ob-landing-mockup-preview">
            <div className="ob-landing-mockup-scene">
              <span className="sun" />
              <span className="score">{copy.score}</span>
              <span className="dino" />
              <span className="cactus c1" />
              <span className="cactus c2" />
              <span className="ground" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
