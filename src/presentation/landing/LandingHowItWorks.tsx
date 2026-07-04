import type { LandingCopy } from "./landingCopy";

export function LandingHowItWorks({
  steps,
}: {
  readonly steps: LandingCopy["steps"];
}) {
  return (
    <section className="ob-landing-section" id="how">
      <div className="ob-landing-container">
        <div className="ob-landing-section-head">
          <h2>{steps.heading}</h2>
          <p>{steps.subheading}</p>
        </div>
        <ol className="ob-landing-timeline">
          {steps.items.map((step) => (
            <li className="ob-landing-timeline-item" key={step.title}>
              <span className="ob-landing-timeline-node" aria-hidden="true" />
              <div className="ob-landing-timeline-body">
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
