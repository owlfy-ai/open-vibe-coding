import type { LandingCopy } from "./landingCopy";

export function LandingFeatures({
  copy,
}: {
  readonly copy: LandingCopy["features"];
}) {
  return (
    <section className="ob-landing-section" id="features">
      <div className="ob-landing-container">
        <div className="ob-landing-section-head">
          <h2>{copy.heading}</h2>
          <p>{copy.subheading}</p>
        </div>
        <div className="ob-landing-features-grid">
          {copy.items.map((item) => (
            <article className="ob-landing-feature" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
